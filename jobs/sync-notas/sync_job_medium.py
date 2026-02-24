"""
Databricks Job: Sync médio — roda a cada 20-30 minutos.

Fluxo:
  1. Consolida status PMPL por ordem via Spark ROW_NUMBER (sem trazer todas as linhas para Python)
  2. Atualiza ordens_notas_acompanhamento com status PMPL
  3. Importa referências ORDEM/TIPO_DOCUMENTO da silver
  4. Importa referências de manutenção (silver.selecao_ordens_manutencao)
  5. Enriquece tipo_ordem e atribui responsável a ordens standalone
"""

from datetime import date, datetime, timedelta, timezone

from pyspark.sql import SparkSession

from sync_shared import (
    PMPL_TABLE,
    PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES,
    PMPL_CENTRO_COLUMN,
    PMPL_TIPO_ORDEM_COLUMN,
    PMPL_FETCH_BATCH_SIZE,
    PMPL_RPC_BATCH_SIZE,
    PMPL_MIN_AGE_DAYS,
    ORDERS_DOCUMENT_SOURCE_TABLE,
    ORDERS_DOCUMENT_ORDER_COLUMN,
    ORDERS_DOCUMENT_TYPE_COLUMN,
    ORDERS_DOCUMENT_UPSERT_BATCH_SIZE,
    ORDERS_MAINTENANCE_SOURCE_TABLE,
    ORDERS_MAINTENANCE_ORDER_COLUMN,
    ORDERS_MAINTENANCE_NOTE_COLUMN,
    ORDERS_MAINTENANCE_TYPE_COLUMN,
    ORDERS_MAINTENANCE_TEXT_COLUMN,
    ORDERS_MAINTENANCE_CENTER_COLUMN,
    ORDERS_MAINTENANCE_EXTRACTION_COLUMN,
    ORDERS_MAINTENANCE_UPSERT_BATCH_SIZE,
    ORDERS_REF_V2_TOLERATED_FAILURES,
    STATUS_PRIORITY,
    STATUS_COLUMNS_CANDIDATES,
    OPEN_STATUS,
    BATCH_SIZE,
    _as_clean_text,
    _normalize_centro,
    _normalize_ordem_codigo,
    _normalize_numero_nota,
    _normalize_tipo_documento_vendas,
    _normalize_tipo_ordem,
    _normalize_iso_date,
    _normalize_iso_datetime,
    _is_statement_timeout_error,
    _is_missing_rpc_error,
    _calculate_maintenance_reference_completeness,
    _is_better_maintenance_reference,
    _resolve_existing_columns,
    _build_date_expr_from_columns,
    _iter_batches,
    _sql_quote,
    get_orders_ref_v2_watermark,
    get_orders_ref_v2_failure_streak,
    set_orders_ref_v2_failure_streak,
    get_pmpl_min_age_days,
    get_pmpl_standalone_window_days,
    get_orders_ref_v2_lookback_days,
    get_sync_start_date,
    should_ignore_watermark,
    create_sync_log,
    finalize_sync_log,
    supabase,
    logger,
)


def _build_pmpl_data_entrada_date_expr(spark: SparkSession) -> str:
    existing = _resolve_existing_columns(spark, PMPL_TABLE, PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES)
    if not existing:
        logger.warning(
            "Nenhuma coluna de data candidata encontrada na tabela %s. Candidatas=%s",
            PMPL_TABLE, PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES,
        )
    return _build_date_expr_from_columns(existing)


def _build_orders_maintenance_data_extracao_expr(spark: SparkSession) -> str:
    existing = _resolve_existing_columns(spark, ORDERS_MAINTENANCE_SOURCE_TABLE, [ORDERS_MAINTENANCE_EXTRACTION_COLUMN])
    if not existing:
        logger.warning(
            "Nenhuma coluna de data extração encontrada na tabela %s. Coluna esperada=%s",
            ORDERS_MAINTENANCE_SOURCE_TABLE, ORDERS_MAINTENANCE_EXTRACTION_COLUMN,
        )
    return _build_date_expr_from_columns(existing)


def _extract_status_raw(row_dict: dict) -> str | None:
    for col in STATUS_COLUMNS_CANDIDATES:
        value = _as_clean_text(row_dict.get(col))
        if value:
            return value.upper().replace(" ", "_")
    return None


def _extract_centro(row_dict: dict) -> str | None:
    return _normalize_centro(row_dict.get(PMPL_CENTRO_COLUMN))


def _extract_data_entrada(row_dict: dict) -> str | None:
    for col in PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES:
        value = _normalize_iso_datetime(row_dict.get(col))
        if value:
            return value
    return None


def get_orders_for_pmpl_refresh(min_age_days: int = PMPL_MIN_AGE_DAYS) -> list[str]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=min_age_days)
    ordem_codes: list[str] = []
    offset = 0
    page = 1000
    open_status_csv = ",".join(sorted(OPEN_STATUS))

    while True:
        result = (
            supabase.table("ordens_notas_acompanhamento")
            .select("ordem_codigo")
            .or_(f"status_ordem.in.({open_status_csv}),data_entrada.is.null")
            .lte("ordem_detectada_em", cutoff.isoformat())
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            break
        ordem_codes.extend(
            code
            for code in (_as_clean_text(r.get("ordem_codigo")) for r in rows)
            if code
        )
        if len(rows) < page:
            break
        offset += page

    logger.info("Ordens elegíveis para refresh PMPL: %s", len(ordem_codes))
    return ordem_codes


def consolidate_pmpl_status_by_order(spark: SparkSession, ordem_codes: list[str]) -> list[dict]:
    """Consolida status PMPL por ordem via Spark ROW_NUMBER (Otimização 2)."""
    if not ordem_codes:
        return []

    # Resolve dinamicamente quais colunas de status existem no PMPL_TABLE
    existing_status_cols = _resolve_existing_columns(spark, PMPL_TABLE, STATUS_COLUMNS_CANDIDATES)
    if not existing_status_cols:
        existing_status_cols = ["STATUS"]  # fallback seguro
    status_coalesce = (
        existing_status_cols[0]
        if len(existing_status_cols) == 1
        else f"COALESCE({', '.join(existing_status_cols)})"
    )
    logger.debug("PMPL status coalesce expr: %s", status_coalesce)

    priority_expr = " ".join([
        f"CASE UPPER(TRIM({status_coalesce}))",
        *[f"WHEN '{k}' THEN {v}" for k, v in STATUS_PRIORITY.items()],
        "ELSE 0 END",
    ])
    data_expr = _build_pmpl_data_entrada_date_expr(spark)
    results = []

    for batch in _iter_batches(sorted(set(ordem_codes)), PMPL_FETCH_BATCH_SIZE):
        escaped = ", ".join(_sql_quote(c) for c in batch)
        df = spark.sql(f"""
            SELECT ORDEM, STATUS_RAW, CENTRO, DATA_ENTRADA, TIPO_ORDEM
            FROM (
              SELECT
                CAST(ORDEM AS STRING)            AS ORDEM,
                UPPER(TRIM({status_coalesce}))   AS STATUS_RAW,
                {PMPL_CENTRO_COLUMN}             AS CENTRO,
                CAST({data_expr} AS STRING)      AS DATA_ENTRADA,
                {PMPL_TIPO_ORDEM_COLUMN}         AS TIPO_ORDEM,
                ROW_NUMBER() OVER (
                  PARTITION BY ORDEM
                  ORDER BY {priority_expr} DESC,
                           {data_expr} DESC NULLS LAST
                ) AS _rn
              FROM {PMPL_TABLE}
              WHERE ORDEM IN ({escaped})
            ) t
            WHERE _rn = 1
        """)
        for row in df.collect():
            d = row.asDict()
            ordem = _normalize_ordem_codigo(d.get("ORDEM"))
            if not ordem:
                continue
            results.append({
                "ordem_codigo": ordem,
                "status_raw": d.get("STATUS_RAW"),
                "centro": _normalize_centro(d.get("CENTRO")),
                "data_entrada": _normalize_iso_datetime(d.get("DATA_ENTRADA")),
                "tipo_ordem": _normalize_tipo_ordem(d.get("TIPO_ORDEM")),
            })

    logger.info("Updates consolidados de status PMPL (Spark ROW_NUMBER): %s", len(results))

    debug_tipo = spark.conf.get("cockpit.sync.debug_tipo_ordem", "0")
    if str(debug_tipo).strip() == "1":
        from collections import Counter
        tipo_counts = Counter(r.get("tipo_ordem") or "NULL" for r in results)
        logger.info("DEBUG tipo_ordem counts: %s", dict(tipo_counts))

    return results


def push_pmpl_updates(sync_id: str, updates: list[dict]) -> tuple[int, int, int]:
    if not updates:
        return 0, 0, 0

    total_recebidas = 0
    ordens_atualizadas = 0
    mudancas_status = 0

    for i in range(0, len(updates), PMPL_RPC_BATCH_SIZE):
        batch = updates[i:i + PMPL_RPC_BATCH_SIZE]
        try:
            result = supabase.rpc("atualizar_status_ordens_pmpl_lote", {"p_updates": batch, "p_sync_id": sync_id}).execute()
        except Exception as exc:
            if _is_statement_timeout_error(exc):
                logger.warning(
                    "Timeout no RPC atualizar_status_ordens_pmpl_lote (57014) no batch %s/%s. erro=%s",
                    (i // PMPL_RPC_BATCH_SIZE) + 1,
                    ((len(updates) - 1) // PMPL_RPC_BATCH_SIZE) + 1,
                    f"{type(exc).__name__}: {exc}",
                )
                break
            raise

        row = (result.data or [{}])[0]
        total_recebidas += int(row.get("total_recebidas") or 0)
        ordens_atualizadas += int(row.get("ordens_atualizadas") or 0)
        mudancas_status += int(row.get("mudancas_status") or 0)

    logger.info("PMPL refresh -> recebidas=%s atualizadas=%s mudancas_status=%s", total_recebidas, ordens_atualizadas, mudancas_status)
    return total_recebidas, ordens_atualizadas, mudancas_status


def read_orders_document_reference(spark: SparkSession) -> tuple[list[dict], dict]:
    df = spark.sql(f"""
        SELECT
          {ORDERS_DOCUMENT_ORDER_COLUMN} AS ORDEM,
          {ORDERS_DOCUMENT_TYPE_COLUMN} AS TIPO_DOCUMENTO_VENDAS
        FROM {ORDERS_DOCUMENT_SOURCE_TABLE}
        WHERE {ORDERS_DOCUMENT_ORDER_COLUMN} IS NOT NULL
          AND {ORDERS_DOCUMENT_TYPE_COLUMN} IS NOT NULL
    """)

    rows = df.collect()
    by_order: dict[str, dict] = {}
    invalid_order = 0
    invalid_type = 0
    conflicts = 0

    for row in rows:
        row_dict = row.asDict()
        ordem_original = _as_clean_text(row_dict.get("ORDEM"))
        ordem_norm = _normalize_ordem_codigo(ordem_original)
        tipo_documento = _normalize_tipo_documento_vendas(row_dict.get("TIPO_DOCUMENTO_VENDAS"))

        if not ordem_norm:
            invalid_order += 1
            continue
        if not tipo_documento:
            invalid_type += 1
            continue

        current = by_order.get(ordem_norm)
        if current and current["tipo_documento_vendas"] != tipo_documento:
            conflicts += 1
            continue

        by_order[ordem_norm] = {
            "ordem_codigo_norm": ordem_norm,
            "ordem_codigo_original": ordem_original or ordem_norm,
            "tipo_documento_vendas": tipo_documento,
        }

    references = list(by_order.values())
    logger.info(
        "Referência ORDEM/TIPO lida da silver: total_rows=%s, validas=%s, ordem_invalida=%s, tipo_invalido=%s, conflitos=%s",
        len(rows), len(references), invalid_order, invalid_type, conflicts,
    )
    return references, {"total_rows": len(rows), "valid_rows": len(references), "invalid_order": invalid_order, "invalid_type": invalid_type, "conflicts": conflicts}


def upsert_orders_document_reference(sync_id: str, references: list[dict]) -> tuple[int, int]:
    if not references:
        return 0, 0

    existing_orders: set[str] = set()
    ordem_codes = [item["ordem_codigo_norm"] for item in references]

    for i in range(0, len(ordem_codes), BATCH_SIZE):
        batch = ordem_codes[i:i + BATCH_SIZE]
        try:
            result = (
                supabase.table("ordens_tipo_documento_referencia")
                .select("ordem_codigo_norm")
                .in_("ordem_codigo_norm", batch)
                .execute()
            )
        except Exception as exc:
            if _is_statement_timeout_error(exc):
                logger.warning("Timeout ao consultar referência ORDEM/TIPO (57014). Pulando. erro=%s", f"{type(exc).__name__}: {exc}")
                return 0, 0
            raise
        existing_orders.update(r["ordem_codigo_norm"] for r in (result.data or []))

    now_iso = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "ordem_codigo_norm": item["ordem_codigo_norm"],
            "ordem_codigo_original": item["ordem_codigo_original"],
            "tipo_documento_vendas": item["tipo_documento_vendas"],
            "fonte": ORDERS_DOCUMENT_SOURCE_TABLE,
            "last_sync_id": sync_id,
            "last_seen_at": now_iso,
        }
        for item in references
    ]

    for i in range(0, len(payload), ORDERS_DOCUMENT_UPSERT_BATCH_SIZE):
        batch = payload[i:i + ORDERS_DOCUMENT_UPSERT_BATCH_SIZE]
        try:
            supabase.table("ordens_tipo_documento_referencia").upsert(batch, on_conflict="ordem_codigo_norm").execute()
        except Exception as exc:
            if _is_statement_timeout_error(exc):
                logger.warning("Timeout no upsert referência ORDEM/TIPO (57014). Interrompendo batches. erro=%s", f"{type(exc).__name__}: {exc}")
                break
            raise

    inserted_count = sum(1 for item in references if item["ordem_codigo_norm"] not in existing_orders)
    updated_count = len(references) - inserted_count
    logger.info("Referência ORDEM/TIPO upsert: inseridas=%s, atualizadas=%s", inserted_count, updated_count)
    return inserted_count, updated_count


def read_orders_maintenance_reference(
    spark: SparkSession,
    sync_start_date: str,
    lookback_days: int,
) -> tuple[list[dict], dict]:
    watermark_raw = get_orders_ref_v2_watermark()
    watermark_date = _normalize_iso_date(watermark_raw)

    if watermark_date:
        effective_start_date = (date.fromisoformat(watermark_date) - timedelta(days=lookback_days)).isoformat()
        effective_start = max(effective_start_date, sync_start_date)
    else:
        effective_start = sync_start_date

    data_extracao_expr = _build_orders_maintenance_data_extracao_expr(spark)
    logger.info(
        "Leitura referência manutenção v2: sync_start_date=%s, watermark=%s, lookback_days=%s, effective_start=%s",
        sync_start_date, watermark_date, lookback_days, effective_start,
    )

    df = spark.sql(f"""
        SELECT
          {ORDERS_MAINTENANCE_ORDER_COLUMN} AS ORDEM,
          {ORDERS_MAINTENANCE_NOTE_COLUMN} AS NOTA,
          {ORDERS_MAINTENANCE_TYPE_COLUMN} AS TIPO_ORDEM,
          {ORDERS_MAINTENANCE_TEXT_COLUMN} AS TEXTO_BREVE,
          {ORDERS_MAINTENANCE_CENTER_COLUMN} AS CENTRO_LIBERACAO,
          {ORDERS_MAINTENANCE_EXTRACTION_COLUMN} AS DATA_EXTRACAO
        FROM {ORDERS_MAINTENANCE_SOURCE_TABLE}
        WHERE {ORDERS_MAINTENANCE_ORDER_COLUMN} IS NOT NULL
          AND (
            {data_extracao_expr} >= date('{effective_start}')
            OR {data_extracao_expr} IS NULL
          )
    """)

    rows = df.collect()
    by_order: dict[str, dict] = {}
    invalid_order = 0
    invalid_type = 0
    dedupe_replaced = 0
    dedupe_discarded = 0

    for row in rows:
        row_dict = row.asDict()
        ordem_original = _as_clean_text(row_dict.get("ORDEM"))
        ordem_norm = _normalize_ordem_codigo(ordem_original)
        if not ordem_norm:
            invalid_order += 1
            continue

        tipo_raw = _as_clean_text(row_dict.get("TIPO_ORDEM"))
        tipo_ordem = _normalize_tipo_ordem(tipo_raw)
        if tipo_raw and not tipo_ordem:
            invalid_type += 1

        nota_original = _as_clean_text(row_dict.get("NOTA"))
        nota_norm = _normalize_numero_nota(nota_original)

        candidate = {
            "ordem_codigo_norm": ordem_norm,
            "ordem_codigo_original": ordem_original or ordem_norm,
            "numero_nota_norm": nota_norm,
            "numero_nota_original": nota_original,
            "tipo_ordem": tipo_ordem,
            "texto_breve": _as_clean_text(row_dict.get("TEXTO_BREVE")),
            "centro_liberacao": _normalize_centro(row_dict.get("CENTRO_LIBERACAO")),
            "data_extracao": _normalize_iso_datetime(row_dict.get("DATA_EXTRACAO")),
        }
        candidate["completeness_score"] = _calculate_maintenance_reference_completeness(candidate)

        current = by_order.get(ordem_norm)
        if current is None:
            by_order[ordem_norm] = candidate
            continue

        if _is_better_maintenance_reference(current, candidate):
            by_order[ordem_norm] = candidate
            dedupe_replaced += 1
        else:
            dedupe_discarded += 1

    references = [
        {
            "ordem_codigo_norm": item["ordem_codigo_norm"],
            "ordem_codigo_original": item["ordem_codigo_original"],
            "numero_nota_norm": item.get("numero_nota_norm"),
            "numero_nota_original": item.get("numero_nota_original"),
            "tipo_ordem": item.get("tipo_ordem"),
            "texto_breve": item.get("texto_breve"),
            "centro_liberacao": item.get("centro_liberacao"),
            "data_extracao": item.get("data_extracao"),
        }
        for item in by_order.values()
    ]

    logger.info(
        "Referência manutenção lida da silver: total_rows=%s, validas=%s, ordem_invalida=%s, tipo_invalido=%s, dedupe_replaced=%s, dedupe_discarded=%s",
        len(rows), len(references), invalid_order, invalid_type, dedupe_replaced, dedupe_discarded,
    )

    return references, {
        "total_rows": len(rows),
        "valid_rows": len(references),
        "invalid_order": invalid_order,
        "invalid_type": invalid_type,
        "dedupe_replaced": dedupe_replaced,
        "dedupe_discarded": dedupe_discarded,
        "effective_start": effective_start,
        "watermark": watermark_date,
    }


def upsert_orders_maintenance_reference(sync_id: str, references: list[dict]) -> tuple[int, int]:
    if not references:
        return 0, 0

    existing_orders: set[str] = set()
    ordem_codes = [item["ordem_codigo_norm"] for item in references]

    for i in range(0, len(ordem_codes), BATCH_SIZE):
        batch = ordem_codes[i:i + BATCH_SIZE]
        result = (
            supabase.table("ordens_manutencao_referencia")
            .select("ordem_codigo_norm")
            .in_("ordem_codigo_norm", batch)
            .execute()
        )
        existing_orders.update(r["ordem_codigo_norm"] for r in (result.data or []))

    now_iso = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "ordem_codigo_norm": item["ordem_codigo_norm"],
            "ordem_codigo_original": item["ordem_codigo_original"],
            "numero_nota_norm": item.get("numero_nota_norm"),
            "numero_nota_original": item.get("numero_nota_original"),
            "tipo_ordem": item.get("tipo_ordem"),
            "texto_breve": item.get("texto_breve"),
            "centro_liberacao": item.get("centro_liberacao"),
            "data_extracao": item.get("data_extracao"),
            "fonte": ORDERS_MAINTENANCE_SOURCE_TABLE,
            "last_sync_id": sync_id,
            "last_seen_at": now_iso,
        }
        for item in references
    ]

    for i in range(0, len(payload), ORDERS_MAINTENANCE_UPSERT_BATCH_SIZE):
        batch = payload[i:i + ORDERS_MAINTENANCE_UPSERT_BATCH_SIZE]
        supabase.table("ordens_manutencao_referencia").upsert(batch, on_conflict="ordem_codigo_norm").execute()

    inserted_count = sum(1 for item in references if item["ordem_codigo_norm"] not in existing_orders)
    updated_count = len(references) - inserted_count
    logger.info("Referência manutenção upsert: inseridas=%s, atualizadas=%s", inserted_count, updated_count)
    return inserted_count, updated_count


def run_orders_maintenance_reference_enrichment() -> dict:
    result = supabase.rpc("enriquecer_ordens_por_referencia_manutencao", {}).execute()
    row = (result.data or [{}])[0]
    metrics = {
        "ordens_atualizadas_total": int(row.get("ordens_atualizadas_total") or 0),
        "tipo_ordem_atualizadas": int(row.get("tipo_ordem_atualizadas") or 0),
        "centro_preenchidos": int(row.get("centro_preenchidos") or 0),
        "numero_nota_preenchidas": int(row.get("numero_nota_preenchidas") or 0),
    }
    logger.info(
        "Enriquecimento manutenção -> total=%s tipo=%s centro=%s numero_nota=%s",
        metrics["ordens_atualizadas_total"], metrics["tipo_ordem_atualizadas"],
        metrics["centro_preenchidos"], metrics["numero_nota_preenchidas"],
    )
    return metrics


def run_standalone_owner_assignment() -> dict:
    rpc_name = "atribuir_responsavel_ordens_standalone"
    try:
        result = supabase.rpc(rpc_name, {}).execute()
    except Exception as exc:
        if _is_statement_timeout_error(exc):
            error_text = f"{type(exc).__name__}: {exc}"
            logger.warning("Timeout no RPC %s (57014). Pulando. erro=%s", rpc_name, error_text)
            return {"total_candidatas": 0, "responsaveis_preenchidos": 0, "atribuicoes_refrigeracao": 0, "atribuicoes_pmpl_config": 0, "atribuicoes_fallback": 0, "sem_destino": 0, "regras_refrigeracao_encontradas": 0, "admins_refrigeracao_elegiveis": 0, "timeout_tolerated": True, "error": error_text[:2000]}
        raise

    row = (result.data or [{}])[0]
    metrics = {
        "total_candidatas": int(row.get("total_candidatas") or 0),
        "responsaveis_preenchidos": int(row.get("responsaveis_preenchidos") or 0),
        "atribuicoes_refrigeracao": int(row.get("atribuicoes_refrigeracao") or 0),
        "atribuicoes_pmpl_config": int(row.get("atribuicoes_pmpl_config") or 0),
        "atribuicoes_cd_fixo": int(row.get("atribuicoes_cd_fixo") or 0),
        "atribuicoes_fallback": int(row.get("atribuicoes_fallback") or 0),
        "sem_destino": int(row.get("sem_destino") or 0),
        "regras_refrigeracao_encontradas": int(row.get("regras_refrigeracao_encontradas") or 0),
        "admins_refrigeracao_elegiveis": int(row.get("admins_refrigeracao_elegiveis") or 0),
        "timeout_tolerated": False,
        "error": None,
    }
    logger.info(
        "Standalone owner assignment -> candidatas=%s preenchidas=%s refrig=%s pmpl_cfg=%s cd_fixo=%s fallback=%s sem_destino=%s",
        metrics["total_candidatas"], metrics["responsaveis_preenchidos"], metrics["atribuicoes_refrigeracao"],
        metrics["atribuicoes_pmpl_config"], metrics["atribuicoes_cd_fixo"], metrics["atribuicoes_fallback"], metrics["sem_destino"],
    )
    if metrics["sem_destino"] > 0:
        logger.warning("Ordens standalone sem destino após atribuição automática: %s", metrics["sem_destino"])
    return metrics


def run_standalone_pmpl_owner_realign() -> dict:
    rpc_name = "realinhar_responsavel_pmpl_standalone"
    try:
        result = supabase.rpc(rpc_name, {}).execute()
    except Exception as exc:
        if _is_statement_timeout_error(exc):
            error_text = f"{type(exc).__name__}: {exc}"
            logger.warning("Timeout no RPC %s (57014). Pulando. erro=%s", rpc_name, error_text)
            return {"rpc_disponivel": True, "total_candidatas": 0, "reatribuicoes": 0, "destino_id": None, "timeout_tolerated": True, "error": error_text[:2000]}
        if _is_missing_rpc_error(exc, rpc_name):
            logger.warning("RPC %s não encontrada no banco. Pulando.", rpc_name)
            return {"rpc_disponivel": False, "total_candidatas": 0, "reatribuicoes": 0, "destino_id": None, "timeout_tolerated": False, "error": None}
        raise

    row = (result.data or [{}])[0]
    metrics = {
        "rpc_disponivel": True,
        "total_candidatas": int(row.get("total_candidatas") or 0),
        "reatribuicoes": int(row.get("reatribuicoes") or 0),
        "destino_id": row.get("destino_id"),
        "timeout_tolerated": False,
        "error": None,
    }
    logger.info("Standalone PMPL realign -> candidatas=%s reatribuicoes=%s destino=%s", metrics["total_candidatas"], metrics["reatribuicoes"], metrics["destino_id"])
    return metrics


def main():
    spark = SparkSession.builder.getOrCreate()
    current_stage = "init"
    sync_start_date = get_sync_start_date(spark)
    ignore_watermark = should_ignore_watermark(spark)
    pmpl_min_age_days = get_pmpl_min_age_days(spark)
    orders_ref_v2_lookback_days = get_orders_ref_v2_lookback_days(spark)

    orders_ref_v2_status = "not_run"
    orders_ref_v2_failure_streak = 0
    orders_ref_v2_error: str | None = None
    orders_ref_v2_metrics = {"total_rows": 0, "valid_rows": 0, "invalid_order": 0, "invalid_type": 0, "dedupe_replaced": 0, "dedupe_discarded": 0, "effective_start": None, "watermark": None}
    ordens_ref_v2_inseridas = 0
    ordens_ref_v2_atualizadas = 0
    orders_ref_v2_enrichment_metrics = {"ordens_atualizadas_total": 0, "tipo_ordem_atualizadas": 0, "centro_preenchidos": 0, "numero_nota_preenchidas": 0}

    try:
        current_stage = "supabase_healthcheck"
        supabase.table("sync_log").select("id").limit(1).execute()
        logger.info("Conexão com Supabase OK.")
    except Exception as e:
        logger.error("FALHA na conexão com Supabase: %s", e)
        raise

    sync_id = create_sync_log(spark)
    logger.info("Sync medium iniciado: %s", sync_id)

    ordens_status_atualizadas = 0
    mudancas_status = 0
    ordens_tipo_ref_inseridas = 0
    ordens_tipo_ref_atualizadas = 0
    tipo_enriquecidas = 0
    standalone_owner_metrics = {"total_candidatas": 0, "responsaveis_preenchidos": 0, "atribuicoes_refrigeracao": 0, "atribuicoes_pmpl_config": 0, "atribuicoes_fallback": 0, "sem_destino": 0, "regras_refrigeracao_encontradas": 0, "admins_refrigeracao_elegiveis": 0, "timeout_tolerated": False, "error": None}
    standalone_pmpl_realign_metrics = {"rpc_disponivel": False, "total_candidatas": 0, "reatribuicoes": 0, "destino_id": None, "timeout_tolerated": False, "error": None}
    orders_document_metrics = {"total_rows": 0, "valid_rows": 0, "invalid_order": 0, "invalid_type": 0, "conflicts": 0}

    try:
        current_stage = "get_orders_for_pmpl_refresh"
        eligible_orders = get_orders_for_pmpl_refresh(min_age_days=pmpl_min_age_days)

        current_stage = "consolidate_pmpl_status_by_order"
        pmpl_updates = consolidate_pmpl_status_by_order(spark, eligible_orders)

        current_stage = "push_pmpl_updates"
        _, ordens_status_atualizadas, mudancas_status = push_pmpl_updates(sync_id, pmpl_updates)

        current_stage = "read_orders_document_reference"
        orders_document_reference, orders_document_metrics = read_orders_document_reference(spark)

        current_stage = "upsert_orders_document_reference"
        ordens_tipo_ref_inseridas, ordens_tipo_ref_atualizadas = upsert_orders_document_reference(sync_id, orders_document_reference)

        current_stage = "enriquecer_tipo_ordem_por_referencia"
        try:
            result_enrich = supabase.rpc("enriquecer_tipo_ordem_por_referencia", {}).execute()
            tipo_enriquecidas = int(result_enrich.data or 0)
            logger.info("tipo_ordem enriquecidas: %s", tipo_enriquecidas)
        except Exception as enrich_tipo_exc:
            if _is_statement_timeout_error(enrich_tipo_exc):
                logger.warning("Timeout no RPC enriquecer_tipo_ordem_por_referencia (57014). Pulando. erro=%s", f"{type(enrich_tipo_exc).__name__}: {enrich_tipo_exc}")
            else:
                raise

        try:
            orders_ref_v2_reference, orders_ref_v2_metrics = read_orders_maintenance_reference(spark, sync_start_date=sync_start_date, lookback_days=orders_ref_v2_lookback_days)
            ordens_ref_v2_inseridas, ordens_ref_v2_atualizadas = upsert_orders_maintenance_reference(sync_id, orders_ref_v2_reference)
            try:
                orders_ref_v2_enrichment_metrics = run_orders_maintenance_reference_enrichment()
                orders_ref_v2_status = "success"
                orders_ref_v2_failure_streak = 0
                set_orders_ref_v2_failure_streak(0, None)
            except Exception as enrich_exc:
                if _is_statement_timeout_error(enrich_exc):
                    orders_ref_v2_status = "error_tolerated"
                    orders_ref_v2_error = f"{type(enrich_exc).__name__}: {enrich_exc}"
                    set_orders_ref_v2_failure_streak(0, orders_ref_v2_error)
                    logger.warning("Timeout no enriquecimento v2 (57014). Zerando streak. erro=%s", orders_ref_v2_error)
                else:
                    raise
        except Exception as ref_v2_exc:
            previous_streak = get_orders_ref_v2_failure_streak()
            orders_ref_v2_failure_streak = previous_streak + 1
            orders_ref_v2_error = f"{type(ref_v2_exc).__name__}: {ref_v2_exc}"
            orders_ref_v2_status = "error_tolerated"
            set_orders_ref_v2_failure_streak(orders_ref_v2_failure_streak, orders_ref_v2_error)
            logger.error("Falha na referência v2 (tolerância ativa): streak=%s limite=%s erro=%s", orders_ref_v2_failure_streak, ORDERS_REF_V2_TOLERATED_FAILURES, orders_ref_v2_error)
            if orders_ref_v2_failure_streak > ORDERS_REF_V2_TOLERATED_FAILURES:
                raise RuntimeError(f"Falha recorrente na referência v2 por {orders_ref_v2_failure_streak} ciclos consecutivos.") from ref_v2_exc

        standalone_owner_metrics = run_standalone_owner_assignment()
        standalone_pmpl_realign_metrics = run_standalone_pmpl_owner_realign()

        metadata = {
            "job": "medium",
            "sync_start_date": sync_start_date,
            "ignore_watermark": ignore_watermark,
            "pmpl_min_age_days": pmpl_min_age_days,
            "ordens_elegiveis_pmpl": len(eligible_orders),
            "ordens_status_atualizadas": ordens_status_atualizadas,
            "ordens_mudanca_status": mudancas_status,
            "ordens_tipo_ref_total_rows": orders_document_metrics["total_rows"],
            "ordens_tipo_ref_valid_rows": orders_document_metrics["valid_rows"],
            "ordens_tipo_ref_inseridas": ordens_tipo_ref_inseridas,
            "ordens_tipo_ref_atualizadas": ordens_tipo_ref_atualizadas,
            "tipo_ordem_enriquecidas": tipo_enriquecidas,
            "orders_ref_v2_status": orders_ref_v2_status,
            "orders_ref_v2_failure_streak": orders_ref_v2_failure_streak,
            "orders_ref_v2_error": orders_ref_v2_error,
            "orders_ref_v2_total_rows": orders_ref_v2_metrics["total_rows"],
            "orders_ref_v2_valid_rows": orders_ref_v2_metrics["valid_rows"],
            "orders_ref_v2_inseridas": ordens_ref_v2_inseridas,
            "orders_ref_v2_atualizadas": ordens_ref_v2_atualizadas,
            "orders_ref_v2_ordens_atualizadas_total": orders_ref_v2_enrichment_metrics["ordens_atualizadas_total"],
            "standalone_owner_total_candidatas": standalone_owner_metrics["total_candidatas"],
            "standalone_owner_preenchidos": standalone_owner_metrics["responsaveis_preenchidos"],
            "standalone_pmpl_realign_reatribuicoes": standalone_pmpl_realign_metrics["reatribuicoes"],
        }

        current_stage = "finalize_sync_log_success"
        try:
            finalize_sync_log(sync_id, read_count=0, inserted=0, updated=ordens_status_atualizadas, distributed=0, metadata=metadata)
        except Exception as finalize_exc:
            if _is_statement_timeout_error(finalize_exc):
                logger.warning("Timeout ao finalizar sync_log (57014). erro=%s", f"{type(finalize_exc).__name__}: {finalize_exc}")
            else:
                raise

        logger.info("Sync medium concluido com sucesso")

    except Exception as e:
        logger.error("Sync medium falhou na etapa '%s': %s: %s", current_stage, type(e).__name__, e)
        try:
            finalize_sync_log(
                sync_id, read_count=0, inserted=0, updated=0, distributed=0,
                metadata={"job": "medium", "sync_start_date": sync_start_date, "orders_ref_v2_status": orders_ref_v2_status, "orders_ref_v2_failure_streak": orders_ref_v2_failure_streak},
                error=str(e),
            )
        except Exception:
            logger.error("Não conseguiu gravar erro no sync_log")
        raise


main()
