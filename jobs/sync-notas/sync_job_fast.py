"""
Databricks Job: Sync rápido de notas — roda a cada 5 minutos.

Fluxo:
  1. Lê notas novas/atualizadas de vw_notas_base_latest (QM+QMEL deduplicados, SELECT colunas, LIMIT 10k)
  2. Upsert no Supabase (tabela notas_manutencao) sem roundtrip de existence check
  3. Registra ordens derivadas de notas
  4. Distribui notas pendentes sem ordem
"""

import json
from datetime import date, datetime, timedelta, timezone

from pyspark.sql import SparkSession

from sync_shared import (
    NOTA_CENTRO_COLUMNS_CANDIDATES,
    BATCH_SIZE,
    _as_clean_text,
    _normalize_centro,
    _extract_centro_from_candidates,
    _normalize_iso_date,
    _normalize_iso_datetime,
    _to_utc_iso_datetime,
    _to_utc_date_str,
    _has_source_closure_without_order,
    _has_future_source_closure_without_order,
    _is_statement_timeout_error,
    _resolve_existing_columns,
    _iter_batches,
    _watermark_is_too_future,
    get_watermark,
    get_sync_window_days,
    should_force_window,
    should_ignore_watermark,
    get_sync_start_date,
    get_bootstrap_mode,
    should_run_full_bootstrap,
    create_sync_log,
    finalize_sync_log,
    supabase,
    logger,
)

GOLD_NOTES_TABLE = "manutencao.gold.vw_notas_base_latest"

# Otimização 1: colunas explícitas + limite por ciclo
MAX_NOTES_PER_CYCLE = 10_000

NOTA_COLUMNS_SELECT = [
    "NUMERO_NOTA", "TIPO_NOTA", "TEXTO_BREVE", "TEXTO_DESC_OBJETO",
    "PRIORIDADE", "TIPO_PRIORIDADE", "CRIADO_POR", "SOLICITANTE",
    "DATA_CRIACAO", "DATA_NOTA", "HORA_NOTA", "DATA_ATUALIZACAO",
    "ORDEM", "CENTRO_MATERIAL",
    "STATUS_OBJ_ADMIN", "N_CONTA_FORNECEDOR", "AUTOR_NOTA_QM_PM",
    "DATA_CONCLUSAO", "DATA_ENC_NOTA",
]


def _build_nota_timestamp_expr(spark: SparkSession, streaming_table: str = GOLD_NOTES_TABLE) -> str:
    """View gold garante HORA_NOTA como TIMESTAMP — expr trivial."""
    existing = _resolve_existing_columns(spark, streaming_table, ["HORA_NOTA"])
    if existing:
        return "HORA_NOTA"
    logger.warning("HORA_NOTA não encontrada em %s — usando NULL como timestamp expr", streaming_table)
    return "NULL"


def _log_empty_result_diagnostics(spark: SparkSession, effective_start_ts: str, nota_ts_expr: str, streaming_table: str):
    try:
        existing_map = {col.upper(): col for col in spark.table(streaming_table).columns}
        hora_col = existing_map.get("HORA_NOTA")
        data_nota_col = existing_map.get("DATA_NOTA")
        numero_col = existing_map.get("NUMERO_NOTA")

        hora_select = f"{hora_col} AS HORA_NOTA" if hora_col else "NULL AS HORA_NOTA"
        data_nota_select = f"{data_nota_col} AS DATA_NOTA" if data_nota_col else "NULL AS DATA_NOTA"
        numero_select = f"{numero_col} AS NUMERO_NOTA" if numero_col else "NULL AS NUMERO_NOTA"

        summary_row = spark.sql(f"""
            SELECT
              COUNT(*) AS total_rows,
              SUM(CASE WHEN {nota_ts_expr} IS NULL THEN 1 ELSE 0 END) AS nota_ts_invalidas,
              MIN({nota_ts_expr}) AS min_nota_ts,
              MAX({nota_ts_expr}) AS max_nota_ts
            FROM {streaming_table}
        """).collect()[0]

        filtered_row = spark.sql(f"""
            SELECT COUNT(*) AS total_filtradas
            FROM {streaming_table}
            WHERE {nota_ts_expr} >= timestamp('{effective_start_ts}')
        """).collect()[0]

        sample_rows = [
            row.asDict()
            for row in spark.sql(f"""
                SELECT
                  {hora_select},
                  {data_nota_select},
                  {numero_select},
                  {nota_ts_expr} AS nota_ts_norm
                FROM {streaming_table}
                ORDER BY {nota_ts_expr} DESC
                LIMIT 5
            """).collect()
        ]

        logger.warning(
            "Diagnóstico source vazio (timestamp): total_rows=%s, invalidas_nota_ts=%s, min_ts=%s, max_ts=%s, total_filtradas=%s, effective_start_ts=%s",
            summary_row["total_rows"], summary_row["nota_ts_invalidas"],
            summary_row["min_nota_ts"], summary_row["max_nota_ts"],
            filtered_row["total_filtradas"], effective_start_ts,
        )
        logger.warning("Amostra timestamp (top 5): %s", sample_rows)
    except Exception as diag_error:
        logger.warning("Falha ao gerar diagnóstico de source vazio: %s", diag_error)


def read_new_notes(
    spark: SparkSession,
    window_days: int,
    force_window: bool,
    ignore_watermark: bool,
    sync_start_date: str,
    full_bootstrap: bool,
    streaming_table: str | None = None,
) -> list[dict]:
    """Lê notas com SELECT colunas explícitas e LIMIT por ciclo."""
    streaming_table = streaming_table or GOLD_NOTES_TABLE
    watermark = get_watermark()
    logger.info(
        "Parametros leitura (timestamp) -> tabela=%s watermark_bruto=%s, sync_start_date=%s, force_window=%s, ignore_watermark=%s, full_bootstrap=%s, window_days=%s",
        streaming_table, watermark, sync_start_date, force_window, ignore_watermark, full_bootstrap, window_days,
    )

    nota_ts_expr = _build_nota_timestamp_expr(spark, streaming_table)

    if full_bootstrap:
        logger.info("Bootstrap inicial ativo (timestamp): leitura ampla da tabela %s desde %s.", streaming_table, sync_start_date)
        effective_start_date = sync_start_date
    elif force_window:
        window_start_date = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
        effective_start_date = max(window_start_date, sync_start_date)
        logger.info("Leitura por janela fixa (timestamp): ultimos %s dias (force_window=%s, inicio_efetivo=%s)", window_days, force_window, effective_start_date)
    elif ignore_watermark:
        effective_start_date = sync_start_date
        logger.info("Leitura configurada para ignorar watermark (timestamp). Inicio efetivo=%s", effective_start_date)
    else:
        watermark_date = _to_utc_date_str(watermark)
        if watermark_date and _watermark_is_too_future(watermark_date):
            logger.warning(
                "Watermark %s esta no futuro. Ignorando watermark e usando sync_start_date=%s",
                watermark_date, sync_start_date,
            )
            watermark_date = None
        if watermark_date:
            # -1 dia: cobre delay de extração entre SAP → Databricks
            wm_with_lookback = (
                date.fromisoformat(watermark_date) - timedelta(days=1)
            ).isoformat()
            effective_start_date = max(wm_with_lookback, sync_start_date)
            logger.info("Watermark: %s | lookback -1d → %s | inicio_efetivo=%s", watermark_date, wm_with_lookback, effective_start_date)
        else:
            effective_start_date = sync_start_date
            logger.info("Sem watermark válido. Leitura iniciando em %s", effective_start_date)

    effective_start_ts = f"{effective_start_date} 00:00:00"

    # Otimização 1: SELECT colunas específicas + LIMIT por ciclo
    existing_cols = _resolve_existing_columns(spark, streaming_table, NOTA_COLUMNS_SELECT)
    select_clause = ", ".join(existing_cols) if existing_cols else "*"

    df = spark.sql(f"""
        SELECT *
        FROM (
            SELECT {select_clause}, {nota_ts_expr} AS NOTA_TS_NORM
            FROM {streaming_table}
        ) t
        WHERE NOTA_TS_NORM IS NOT NULL
          AND NOTA_TS_NORM >= timestamp('{effective_start_ts}')
        ORDER BY NOTA_TS_NORM ASC, NUMERO_NOTA ASC
        LIMIT {MAX_NOTES_PER_CYCLE}
    """)

    rows = df.collect()
    if not rows:
        _log_empty_result_diagnostics(spark, effective_start_ts, nota_ts_expr, streaming_table)

    if len(rows) == MAX_NOTES_PER_CYCLE:
        logger.warning(
            "Ciclo limitado a %s notas (MAX_NOTES_PER_CYCLE). Restante será pego no próximo ciclo via watermark.",
            MAX_NOTES_PER_CYCLE,
        )

    notes: list[dict] = []
    missing_centro = 0
    source_closed_without_order = 0
    source_future_closure_without_order = 0

    for row in rows:
        row_dict = row.asDict()
        numero = _as_clean_text(row_dict.get("NUMERO_NOTA"))
        if not numero:
            continue

        centro = _extract_centro_from_candidates(row_dict, NOTA_CENTRO_COLUMNS_CANDIDATES)
        if not centro:
            missing_centro += 1

        source_closed = _has_source_closure_without_order(row_dict)
        if source_closed:
            source_closed_without_order += 1
        elif _has_future_source_closure_without_order(row_dict):
            source_future_closure_without_order += 1

        hora_nota_iso = _to_utc_iso_datetime(
            row_dict.get("HORA_NOTA")
            or row_dict.get("hora_nota")
            or row_dict.get("__timestamp")
            or row_dict.get("__TIMESTAMP")
            or row_dict.get("DATA_ATUALIZACAO")
            or row_dict.get("NOTA_TS_NORM")
        )
        data_criacao_sap = (
            _to_utc_date_str(hora_nota_iso)
            or _to_utc_date_str(row_dict.get("DATA_CRIACAO"))
            or _to_utc_date_str(row_dict.get("DATA_NOTA"))
        )
        data_nota = _to_utc_date_str(row_dict.get("DATA_NOTA")) or data_criacao_sap

        notes.append({
            "numero_nota": numero,
            "tipo_nota": row_dict.get("TIPO_NOTA"),
            "descricao": row_dict.get("TEXTO_BREVE") or "Sem descrição",
            "descricao_objeto": row_dict.get("TEXTO_DESC_OBJETO"),
            "prioridade": row_dict.get("PRIORIDADE"),
            "tipo_prioridade": row_dict.get("TIPO_PRIORIDADE"),
            "criado_por_sap": row_dict.get("CRIADO_POR"),
            "solicitante": row_dict.get("SOLICITANTE"),
            "data_criacao_sap": data_criacao_sap,
            "data_nota": data_nota,
            "hora_nota": hora_nota_iso or _as_clean_text(row_dict.get("HORA_NOTA")) or _as_clean_text(row_dict.get("hora_nota")),
            "ordem_sap": _as_clean_text(row_dict.get("ORDEM")),
            "centro": centro,
            "status_sap": _as_clean_text(row_dict.get("STATUS_OBJ_ADMIN")),
            "conta_fornecedor": row_dict.get("N_CONTA_FORNECEDOR"),
            "autor_nota": row_dict.get("AUTOR_NOTA_QM_PM"),
            "status": "cancelada" if source_closed else None,
            "raw_data": json.dumps(row_dict, default=str),
        })

    if missing_centro > 0:
        logger.warning("Notas sem centro no lote lido: %s", missing_centro)
    if source_closed_without_order > 0:
        logger.info("Notas com encerramento SAP e sem ordem no lote (serão marcadas como cancelada): %s", source_closed_without_order)
    if source_future_closure_without_order > 0:
        logger.info("Notas com DATA_CONCLUSAO futura e sem ordem no lote (NÃO serão canceladas): %s", source_future_closure_without_order)

    logger.info("Leitura por timestamp concluída [%s]: %s notas (NOTA_TS_NORM >= %s).", streaming_table, len(notes), effective_start_ts)
    return notes


def upsert_notes(notes: list[dict], sync_id: str) -> tuple[int, int]:
    """Upsert notas no Supabase sem existence check prévio."""
    if not notes:
        return 0, 0

    deduped_by_number: dict[str, dict] = {}
    for note in notes:
        numero = _as_clean_text(note.get("numero_nota"))
        if not numero:
            continue
        payload = dict(note)
        payload["numero_nota"] = numero
        payload["sync_id"] = sync_id
        deduped_by_number[numero] = payload

    deduped_notes = list(deduped_by_number.values())
    if not deduped_notes:
        return 0, 0

    duplicated_count = len(notes) - len(deduped_notes)
    if duplicated_count > 0:
        logger.warning("Notas duplicadas no lote por numero_nota: %s.", duplicated_count)

    sap_fields = [
        "tipo_nota", "descricao", "descricao_objeto", "prioridade",
        "tipo_prioridade", "criado_por_sap", "solicitante",
        "data_criacao_sap", "data_nota", "hora_nota", "ordem_sap",
        "centro", "status_sap", "conta_fornecedor", "autor_nota",
        "raw_data", "sync_id",
    ]

    ordem_sap_preservada_count = 0
    status_cancelada_from_source_count = 0
    upsert_payload_regular: list[dict] = []
    upsert_payload_cancelada: list[dict] = []

    for note in deduped_notes:
        payload = {"numero_nota": note["numero_nota"]}
        for field in sap_fields:
            if field not in note:
                continue
            if field == "ordem_sap":
                ordem_sap_value = _as_clean_text(note.get("ordem_sap"))
                if ordem_sap_value:
                    payload["ordem_sap"] = ordem_sap_value
                else:
                    ordem_sap_preservada_count += 1
                continue
            payload[field] = note[field]

        if note.get("status") == "cancelada":
            payload["status"] = "cancelada"
            status_cancelada_from_source_count += 1
            upsert_payload_cancelada.append(payload)
        else:
            upsert_payload_regular.append(payload)

    # Lotes separados para evitar status=NULL no PostgREST em lotes mistos
    for payload_group in (upsert_payload_regular, upsert_payload_cancelada):
        for i in range(0, len(payload_group), 500):
            batch = payload_group[i:i + 500]
            supabase.table("notas_manutencao").upsert(batch, on_conflict="numero_nota").execute()

    total = len(deduped_notes)
    logger.info("Upsert notas: total=%s (deduped)", total)
    if ordem_sap_preservada_count:
        logger.info("ordem_sap preservada por regra anti-null em %s nota(s).", ordem_sap_preservada_count)
    if status_cancelada_from_source_count:
        logger.info("status=cancelada aplicado por encerramento SAP sem ordem em %s nota(s).", status_cancelada_from_source_count)

    # Sem existence check: retorna total como "updated" (conservador, sem N+1 roundtrips)
    return 0, total


def run_register_orders(sync_id: str) -> tuple[int, int]:
    try:
        result = supabase.rpc("registrar_ordens_por_notas", {"p_sync_id": sync_id}).execute()
    except Exception as exc:
        if _is_statement_timeout_error(exc):
            logger.warning("Timeout no RPC registrar_ordens_por_notas (57014). Pulando. erro=%s", f"{type(exc).__name__}: {exc}")
            return 0, 0
        raise
    row = (result.data or [{}])[0]
    detectadas = int(row.get("ordens_detectadas") or 0)
    auto_concluidas = int(row.get("notas_auto_concluidas") or 0)
    logger.info("Ordens detectadas: %s | Notas auto-concluídas: %s", detectadas, auto_concluidas)
    return detectadas, auto_concluidas


def run_distribution(sync_id: str) -> int:
    try:
        result = supabase.rpc("distribuir_notas", {"p_sync_id": sync_id}).execute()
    except Exception as exc:
        if _is_statement_timeout_error(exc):
            logger.warning("Timeout no RPC distribuir_notas (57014). Pulando. erro=%s", f"{type(exc).__name__}: {exc}")
            return 0
        raise
    distributed = len(result.data) if result.data else 0
    logger.info("Distribuidas: %s", distributed)
    return distributed


def main():
    spark = SparkSession.builder.getOrCreate()
    current_stage = "bootstrap"
    window_days = get_sync_window_days(spark)
    force_window = should_force_window(spark)
    ignore_watermark = should_ignore_watermark(spark)
    sync_start_date = get_sync_start_date(spark)
    bootstrap_mode = get_bootstrap_mode(spark)

    try:
        current_stage = "supabase_healthcheck"
        supabase.table("sync_log").select("id").limit(1).execute()
        logger.info("Conexão com Supabase OK.")
    except Exception as e:
        logger.error("FALHA na conexão com Supabase: %s", e)
        raise

    sync_id = create_sync_log(spark)
    logger.info("Sync fast iniciado: %s", sync_id)

    inserted = 0
    updated = 0
    distributed = 0
    ordens_detectadas = 0
    notas_auto_concluidas = 0

    try:
        current_stage = "read_new_notes"
        full_bootstrap = should_run_full_bootstrap(bootstrap_mode, sync_start_date)
        notes = read_new_notes(
            spark,
            window_days=window_days,
            force_window=force_window,
            ignore_watermark=ignore_watermark,
            sync_start_date=sync_start_date,
            full_bootstrap=full_bootstrap,
            streaming_table=GOLD_NOTES_TABLE,
        )
        logger.info("Lidas: %s notas da view gold (QM+QMEL deduped)", len(notes))

        current_stage = "upsert_notes"
        inserted, updated = upsert_notes(notes, sync_id)

        current_stage = "run_register_orders"
        ordens_detectadas, notas_auto_concluidas = run_register_orders(sync_id)

        current_stage = "run_distribution"
        distributed = run_distribution(sync_id)

        metadata = {
            "job": "fast",
            "window_days": window_days,
            "force_window": force_window,
            "ignore_watermark": ignore_watermark,
            "sync_start_date": sync_start_date,
            "streaming_table": GOLD_NOTES_TABLE,
            "bootstrap_mode": bootstrap_mode,
            "full_bootstrap": full_bootstrap,
            "max_notes_per_cycle": MAX_NOTES_PER_CYCLE,
            "ordens_detectadas": ordens_detectadas,
            "notas_auto_concluidas": notas_auto_concluidas,
        }

        current_stage = "finalize_sync_log_success"
        try:
            finalize_sync_log(sync_id, read_count=len(notes), inserted=inserted, updated=updated, distributed=distributed, metadata=metadata)
        except Exception as finalize_exc:
            if _is_statement_timeout_error(finalize_exc):
                logger.warning("Timeout ao finalizar sync_log (57014). erro=%s", f"{type(finalize_exc).__name__}: {finalize_exc}")
            else:
                raise

        logger.info("Sync fast concluido com sucesso")

    except Exception as e:
        logger.error("Sync fast falhou na etapa '%s': %s: %s", current_stage, type(e).__name__, e)
        try:
            finalize_sync_log(
                sync_id, read_count=0, inserted=0, updated=0, distributed=0,
                metadata={"job": "fast", "window_days": window_days, "sync_start_date": sync_start_date, "streaming_table": GOLD_NOTES_TABLE},
                error=str(e),
            )
        except Exception:
            logger.error("Não conseguiu gravar erro no sync_log")
        raise


main()
