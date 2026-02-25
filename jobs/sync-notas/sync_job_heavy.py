"""
Databricks Job: Sync pesado — roda 1x por hora.

Fluxo:
  1. Importa ordens PMPL standalone com watermark incremental (Otimização 3)
  2. Constrói dataset de convergência do cockpit de forma incremental (Otimização 4)
  3. Upsert em notas_convergencia_cockpit
"""

from datetime import date, datetime, timedelta, timezone

from pyspark.sql import SparkSession

from sync_shared import (
    STREAMING_TABLE,
    STREAMING_TABLE_QMEL,
    PMPL_TABLE,
    PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES,
    PMPL_CENTRO_COLUMN,
    PMPL_TIPO_ORDEM_COLUMN,
    PMPL_STANDALONE_WINDOW_DAYS,
    PMPL_STANDALONE_BATCH_SIZE,
    PMPL_STANDALONE_TIPO_ORDENS,
    PMPL_STANDALONE_LOOKBACK_DAYS,
    PMPL_RPC_BATCH_SIZE,
    COCKPIT_CONVERGENCE_TABLE,
    COCKPIT_CONVERGENCE_UPSERT_BATCH_SIZE,
    COCKPIT_CONVERGENCE_FETCH_PAGE_SIZE,
    COCKPIT_CONVERGENCE_SPARK_LOOKUP_BATCH_SIZE,
    CONVERGENCE_INCREMENTAL_DAYS,
    COCKPIT_ESTADO_OPERACIONAL_VALUES,
    STATUS_PRIORITY,
    STATUS_COLUMNS_CANDIDATES,
    BATCH_SIZE,
    _as_clean_text,
    _normalize_centro,
    _normalize_ordem_codigo,
    _normalize_numero_nota,
    _normalize_iso_date,
    _normalize_iso_datetime,
    _extract_raw_data_field,
    _is_open_note_status,
    _resolve_hora_base_utc,
    _classify_cockpit_estado_operacional,
    _is_statement_timeout_error,
    _calculate_maintenance_reference_completeness,
    _is_better_maintenance_reference,
    _resolve_existing_columns,
    _build_date_expr_from_columns,
    _iter_batches,
    _sql_quote,
    _fetch_all_table_rows,
    get_pmpl_standalone_watermark,
    get_pmpl_standalone_window_days,
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


def read_standalone_pmpl_orders(
    spark: SparkSession,
    window_days: int,
    sync_start_date: str,
    ignore_watermark: bool,
) -> list[dict]:
    """Lê ordens PMPL standalone com watermark incremental (Otimização 3)."""
    if ignore_watermark:
        effective_start = sync_start_date
    else:
        # Otimização 3: watermark incremental do Supabase
        pmpl_watermark = get_pmpl_standalone_watermark()
        if pmpl_watermark:
            wm_date = (date.fromisoformat(pmpl_watermark) - timedelta(days=PMPL_STANDALONE_LOOKBACK_DAYS)).isoformat()
            window_start = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
            effective_start = max(wm_date, sync_start_date)
            logger.info(
                "PMPL standalone watermark: %s → effective_start=%s (window_start=%s)",
                pmpl_watermark, effective_start, window_start,
            )
        else:
            window_start = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
            effective_start = max(window_start, sync_start_date)

    data_expr = _build_pmpl_data_entrada_date_expr(spark)
    tipos_escaped = ", ".join(f"'{t}'" for t in PMPL_STANDALONE_TIPO_ORDENS)
    logger.info(
        "Lendo ordens standalone (%s): effective_start=%s, window_days=%s, ignore_watermark=%s",
        tipos_escaped, effective_start, window_days, ignore_watermark,
    )

    df = spark.sql(f"""
        SELECT *
        FROM {PMPL_TABLE}
        WHERE {PMPL_TIPO_ORDEM_COLUMN} IN ({tipos_escaped})
          AND ORDEM IS NOT NULL
          AND (
            {data_expr} >= date('{effective_start}')
            OR {data_expr} IS NULL
          )
    """)

    best_by_order: dict[str, dict] = {}

    for row in df.collect():
        row_dict = row.asDict()
        ordem_raw = _as_clean_text(row_dict.get("ORDEM"))
        if not ordem_raw:
            continue

        ordem_codigo = _normalize_ordem_codigo(ordem_raw) or ordem_raw
        status_raw = _extract_status_raw(row_dict)
        if not status_raw:
            continue

        centro = _extract_centro(row_dict)
        data_entrada = _extract_data_entrada(row_dict)
        tipo_ordem = _as_clean_text(row_dict.get(PMPL_TIPO_ORDEM_COLUMN)) or "PMPL"
        priority = STATUS_PRIORITY.get(status_raw, 0)

        current = best_by_order.get(ordem_codigo)
        if current is None or priority > current["priority"]:
            best_by_order[ordem_codigo] = {
                "ordem_codigo": ordem_codigo,
                "status_raw": status_raw,
                "centro": centro,
                "data_entrada": data_entrada or (current.get("data_entrada") if current else None),
                "tipo_ordem": tipo_ordem,
                "priority": priority,
            }
        else:
            if current.get("data_entrada") is None and data_entrada is not None:
                current["data_entrada"] = data_entrada

    orders = [
        {
            "ordem_codigo": v["ordem_codigo"],
            "status_raw": v["status_raw"],
            "centro": v["centro"],
            "data_entrada": v.get("data_entrada"),
            "tipo_ordem": v.get("tipo_ordem") or "PMPL",
        }
        for v in best_by_order.values()
    ]

    logger.info("Ordens PMPL standalone lidas: %s (effective_start=%s)", len(orders), effective_start)
    return orders


def push_standalone_pmpl_orders(sync_id: str, orders: list[dict]) -> tuple[int, int, int]:
    if not orders:
        return 0, 0, 0

    total_recebidas = 0
    inseridas = 0
    atualizadas = 0

    for i in range(0, len(orders), PMPL_STANDALONE_BATCH_SIZE):
        batch = orders[i:i + PMPL_STANDALONE_BATCH_SIZE]
        try:
            result = supabase.rpc("importar_ordens_pmpl_standalone", {"p_orders": batch, "p_sync_id": sync_id}).execute()
        except Exception as exc:
            if _is_statement_timeout_error(exc):
                logger.warning(
                    "Timeout no RPC importar_ordens_pmpl_standalone (57014) no batch %s/%s. erro=%s",
                    (i // PMPL_STANDALONE_BATCH_SIZE) + 1,
                    ((len(orders) - 1) // PMPL_STANDALONE_BATCH_SIZE) + 1,
                    f"{type(exc).__name__}: {exc}",
                )
                break
            raise

        row = (result.data or [{}])[0]
        total_recebidas += int(row.get("total_recebidas") or 0)
        inseridas       += int(row.get("inseridas")       or 0)
        atualizadas     += int(row.get("atualizadas")     or 0)

    logger.info("PMPL standalone import -> recebidas=%s inseridas=%s atualizadas=%s", total_recebidas, inseridas, atualizadas)
    return total_recebidas, inseridas, atualizadas


def _fetch_qmel_latest_rows_by_note(
    spark: SparkSession,
    note_numbers: list[str],
) -> dict[str, dict]:
    if not note_numbers:
        return {}

    tables_to_query = [STREAMING_TABLE_QMEL, STREAMING_TABLE]
    by_note_norm: dict[str, dict] = {}
    primary_missing = True

    for table in tables_to_query:
        try:
            existing_map = {col.upper(): col for col in spark.table(table).columns}
        except Exception as e:
            logger.warning("Tabela %s indisponível para QMEL lookup, pulando. erro=%s", table, e)
            continue

        numero_col = existing_map.get("NUMERO_NOTA")
        ordem_col = existing_map.get("ORDEM")
        if not numero_col:
            logger.warning("Coluna NUMERO_NOTA não encontrada em %s, pulando.", table)
            continue

        if table == STREAMING_TABLE:
            primary_missing = False

        rank_candidates = [
            existing_map.get("DATA_ATUALIZACAO"),
            existing_map.get("__TIMESTAMP"),
            existing_map.get("DATA_CRIACAO"),
        ]
        rank_parts = []
        for col in rank_candidates:
            if not col:
                continue
            rank_parts.append(
                "coalesce("
                f"to_timestamp(cast({col} as string)), "
                f"to_timestamp(cast({col} as string), 'yyyy-MM-dd HH:mm:ss'), "
                f"to_timestamp(cast({col} as string), 'yyyy-MM-dd HH:mm'), "
                f"to_timestamp(cast({col} as string), 'yyyy-MM-dd')"
                ") DESC"
            )
        rank_parts.append(f"{numero_col} DESC")
        rank_clause = ", ".join(rank_parts)

        for batch in _iter_batches(sorted(set(note_numbers)), COCKPIT_CONVERGENCE_SPARK_LOOKUP_BATCH_SIZE):
            escaped = ", ".join(_sql_quote(item) for item in batch)
            ordem_select = ordem_col if ordem_col else "NULL"
            df = spark.sql(f"""
                SELECT
                  {numero_col} AS NUMERO_NOTA,
                  {ordem_select} AS ORDEM
                FROM (
                  SELECT
                    {numero_col},
                    {ordem_select},
                    ROW_NUMBER() OVER (
                      PARTITION BY {numero_col}
                      ORDER BY {rank_clause}
                    ) AS _rn
                  FROM {table}
                  WHERE {numero_col} IN ({escaped})
                ) t
                WHERE _rn = 1
            """)

            for row in df.collect():
                row_dict = row.asDict()
                numero_raw = _as_clean_text(row_dict.get("NUMERO_NOTA"))
                numero_norm = _normalize_numero_nota(numero_raw)
                if not numero_norm:
                    continue
                by_note_norm[numero_norm] = {
                    "numero_nota": numero_raw or numero_norm,
                    "ordem_qmel_raw": _as_clean_text(row_dict.get("ORDEM")),
                }

    if primary_missing:
        raise RuntimeError(
            f"Coluna NUMERO_NOTA não encontrada em {STREAMING_TABLE}. "
            "Não foi possível montar convergência do cockpit."
        )

    return by_note_norm


def _fetch_best_bridge_order_by_note(note_norms: list[str]) -> dict[str, dict]:
    if not note_norms:
        return {}

    by_note_norm: dict[str, dict] = {}
    for batch in _iter_batches(sorted(set(note_norms)), BATCH_SIZE):
        result = (
            supabase.table("ordens_manutencao_referencia")
            .select("ordem_codigo_norm, ordem_codigo_original, numero_nota_norm, tipo_ordem, texto_breve, centro_liberacao, data_extracao")
            .in_("numero_nota_norm", batch)
            .execute()
        )
        for row in (result.data or []):
            numero_nota_norm = _normalize_numero_nota(row.get("numero_nota_norm"))
            ordem_norm = _normalize_ordem_codigo(row.get("ordem_codigo_norm") or row.get("ordem_codigo_original"))
            if not numero_nota_norm or not ordem_norm:
                continue

            candidate = {
                "numero_nota_norm": numero_nota_norm,
                "ordem_codigo_norm": ordem_norm,
                "ordem_codigo_original": _as_clean_text(row.get("ordem_codigo_original")) or ordem_norm,
                "tipo_ordem": row.get("tipo_ordem"),
                "texto_breve": _as_clean_text(row.get("texto_breve")),
                "centro_liberacao": _normalize_centro(row.get("centro_liberacao")),
                "data_extracao": _normalize_iso_datetime(row.get("data_extracao")),
            }
            candidate["completeness_score"] = _calculate_maintenance_reference_completeness(candidate)

            current = by_note_norm.get(numero_nota_norm)
            if current is None or _is_better_maintenance_reference(current, candidate):
                by_note_norm[numero_nota_norm] = candidate

    return by_note_norm


def _fetch_mestre_presence_by_order(order_norms: list[str]) -> set[str]:
    present: set[str] = set()
    if not order_norms:
        return present

    for batch in _iter_batches(sorted(set(order_norms)), BATCH_SIZE):
        result = (
            supabase.table("ordens_tipo_documento_referencia")
            .select("ordem_codigo_norm")
            .in_("ordem_codigo_norm", batch)
            .execute()
        )
        for row in (result.data or []):
            ordem_norm = _normalize_ordem_codigo(row.get("ordem_codigo_norm"))
            if ordem_norm:
                present.add(ordem_norm)

    return present


def _fetch_pmpl_presence_by_order(spark: SparkSession, order_lookup_values: list[str]) -> set[str]:
    present: set[str] = set()
    if not order_lookup_values:
        return present

    for batch in _iter_batches(sorted(set(order_lookup_values)), COCKPIT_CONVERGENCE_SPARK_LOOKUP_BATCH_SIZE):
        escaped = ", ".join(_sql_quote(item) for item in batch)
        df = spark.sql(f"""
            SELECT DISTINCT ORDEM
            FROM {PMPL_TABLE}
            WHERE ORDEM IN ({escaped})
              AND ORDEM IS NOT NULL
        """)
        for row in df.collect():
            ordem_norm = _normalize_ordem_codigo(row.asDict().get("ORDEM"))
            if ordem_norm:
                present.add(ordem_norm)

    return present


def _fetch_order_link_sets() -> tuple[set[str], set[str]]:
    """Retorna sets de nota_id e numero_nota com ordem ATIVA vinculada.

    Filtro server-side exclui ordens concluidas/canceladas, evitando
    transferência de ~40k linhas inativas do Supabase.
    """
    linked_note_ids: set[str] = set()
    linked_note_norms: set[str] = set()
    last_id: str | None = None
    page_size = COCKPIT_CONVERGENCE_FETCH_PAGE_SIZE

    while True:
        query = (
            supabase.table("ordens_notas_acompanhamento")
            .select("id,nota_id,numero_nota")
            .filter("status_ordem", "not.in", "(concluida,cancelada)")
            .order("id", desc=False)
            .limit(page_size)
        )
        if last_id is not None:
            query = query.gt("id", last_id)

        result = query.execute()
        batch = result.data or []
        if not batch:
            break

        for row in batch:
            nota_id = _as_clean_text(row.get("nota_id"))
            if nota_id:
                linked_note_ids.add(nota_id)
            numero_norm = _normalize_numero_nota(row.get("numero_nota"))
            if numero_norm:
                linked_note_norms.add(numero_norm)

        if len(batch) < page_size:
            break

        last_id = batch[-1].get("id")
        if last_id is None:
            break

    return linked_note_ids, linked_note_norms


def _build_not_eligible_reasons(
    *,
    estado_operacional: str,
    eligible_cockpit: bool,
    tem_ordem_vinculada: bool,
    status_elegivel: bool,
    tem_qmel: bool,
    tem_pmpl: bool,
    tem_mestre: bool,
) -> tuple[str | None, list[str]]:
    if eligible_cockpit:
        return None, []

    reason_codes: list[str] = []
    reason_codes.append(f"state_{estado_operacional.lower()}")
    if tem_ordem_vinculada:
        reason_codes.append("has_order_linked")
    if not status_elegivel:
        reason_codes.append("invalid_status")
    if not tem_qmel:
        reason_codes.append("missing_qmel")
    if not tem_pmpl:
        reason_codes.append("missing_pmpl")
    if not tem_mestre:
        reason_codes.append("missing_mestre")
    return estado_operacional, reason_codes


def build_cockpit_convergence_dataset(
    spark: SparkSession,
    incremental_days: int = CONVERGENCE_INCREMENTAL_DAYS,
) -> tuple[list[dict], dict]:
    """Constrói dataset de convergência com leitura incremental (Otimização 4)."""
    full_rebuild = spark.conf.get("cockpit.sync.convergence_full_rebuild", "false") == "true"

    if full_rebuild:
        notes = _fetch_all_table_rows(
            "notas_manutencao",
            (
                "id,numero_nota,ordem_sap,ordem_gerada,status,status_sap,hora_nota,"
                "descricao,centro,administrador_id,data_criacao_sap,raw_data,created_at,updated_at"
            ),
            "numero_nota",
        )
        logger.info("Convergência: full rebuild ativado (%s notas)", len(notes))
    else:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=incremental_days)).isoformat()
        result = (
            supabase.table("notas_manutencao")
            .select(
                (
                    "id,numero_nota,ordem_sap,ordem_gerada,status,status_sap,hora_nota,"
                    "descricao,centro,administrador_id,data_criacao_sap,raw_data,created_at,updated_at"
                )
            )
            .gte("updated_at", cutoff)
            .order("numero_nota")
            .execute()
        )
        notes = result.data or []
        logger.info("Convergência incremental: %s notas (updated_at >= %s)", len(notes), cutoff)

    if not notes:
        metrics = {
            "total_rows": 0,
            "eligible_rows": 0,
            "missing_pmpl": 0,
            "missing_mestre": 0,
            "has_order_linked": 0,
            "invalid_status": 0,
            "total_com_ordem": 0,
            "total_encerrada_sem_ordem": 0,
            "total_aguardando_convergencia": 0,
            "total_cancelada": 0,
            "estado_operacional_counts": {k: 0 for k in COCKPIT_ESTADO_OPERACIONAL_VALUES},
        }
        return [], metrics

    deduped_notes: dict[str, dict] = {}
    for row in notes:
        numero_nota = _as_clean_text(row.get("numero_nota"))
        numero_nota_norm = _normalize_numero_nota(numero_nota)
        if not numero_nota or not numero_nota_norm:
            continue
        current = deduped_notes.get(numero_nota)
        if current is None:
            deduped_notes[numero_nota] = row
            continue
        current_updated = _normalize_iso_datetime(current.get("updated_at"))
        candidate_updated = _normalize_iso_datetime(row.get("updated_at"))
        if candidate_updated and current_updated:
            if candidate_updated > current_updated:
                deduped_notes[numero_nota] = row
        elif candidate_updated and not current_updated:
            deduped_notes[numero_nota] = row

    notes = list(deduped_notes.values())
    note_numbers = [row["numero_nota"] for row in notes if _as_clean_text(row.get("numero_nota"))]
    note_norms = [norm for norm in (_normalize_numero_nota(row.get("numero_nota")) for row in notes) if norm]

    try:
        qmel_by_note = _fetch_qmel_latest_rows_by_note(spark, note_numbers)
    except Exception as exc:
        logger.warning(
            "QMEL streaming table lookup falhou (%s: %s); continuando sem dados QMEL "
            "(não afeta eligible_cockpit nem estado_operacional).",
            type(exc).__name__, exc,
        )
        qmel_by_note = {}
    bridge_by_note = _fetch_best_bridge_order_by_note(note_norms)
    linked_note_ids, linked_note_norms = _fetch_order_link_sets()

    base_rows: list[dict] = []
    ordem_candidates_norm: set[str] = set()
    ordem_lookup_values: set[str] = set()

    for row in notes:
        numero_nota = _as_clean_text(row.get("numero_nota"))
        numero_nota_norm = _normalize_numero_nota(numero_nota)
        if not numero_nota or not numero_nota_norm:
            continue

        qmel_row = qmel_by_note.get(numero_nota_norm)
        bridge_row = bridge_by_note.get(numero_nota_norm)

        ordem_sap = _as_clean_text(row.get("ordem_sap"))
        ordem_gerada = _as_clean_text(row.get("ordem_gerada"))
        ordem_qmel_raw = _as_clean_text(qmel_row.get("ordem_qmel_raw") if qmel_row else None) or ordem_sap
        ordem_qmel_norm = _normalize_ordem_codigo(ordem_qmel_raw)
        ordem_bridge_raw = _as_clean_text(bridge_row.get("ordem_codigo_original") if bridge_row else None)
        ordem_bridge_norm = _normalize_ordem_codigo((bridge_row.get("ordem_codigo_norm") if bridge_row else None) or ordem_bridge_raw)
        ordem_candidata = ordem_qmel_raw or ordem_bridge_raw
        ordem_candidata_norm = ordem_qmel_norm or ordem_bridge_norm

        if ordem_candidata_norm:
            ordem_candidates_norm.add(ordem_candidata_norm)
        for value in (ordem_candidata, ordem_candidata_norm):
            clean = _as_clean_text(value)
            if clean:
                ordem_lookup_values.add(clean)

        nota_id = _as_clean_text(row.get("id"))
        status_raw = _as_clean_text(row.get("status"))
        status_norm = status_raw.lower() if status_raw else None
        status_elegivel = _is_open_note_status(status_norm)
        # ordem_sap/ordem_gerada refletem vínculos históricos do SAP e podem
        # estar preenchidos mesmo quando a ordem já foi concluída/cancelada.
        # A fonte de verdade para vínculo ATIVO é ordens_notas_acompanhamento
        # filtrado por status ativo (ver _fetch_order_link_sets).
        tem_ordem_vinculada = bool(
            (nota_id and nota_id in linked_note_ids)
            or (numero_nota_norm in linked_note_norms)
        )
        status_sap = _as_clean_text(row.get("status_sap"))
        raw_data = row.get("raw_data")
        data_conclusao = _extract_raw_data_field(raw_data, "DATA_CONCLUSAO")
        data_enc_nota = _extract_raw_data_field(raw_data, "DATA_ENC_NOTA")
        hora_base_utc = _resolve_hora_base_utc(
            row.get("hora_nota"),
            row.get("data_criacao_sap"),
            row.get("created_at"),
        )
        estado_operacional = _classify_cockpit_estado_operacional(
            tem_ordem_vinculada=tem_ordem_vinculada,
            status_nota=status_norm,
            status_sap=status_sap,
            data_conclusao=data_conclusao,
            data_enc_nota=data_enc_nota,
            hora_base_utc=hora_base_utc,
        )

        base_rows.append({
            "numero_nota": numero_nota,
            "numero_nota_norm": numero_nota_norm,
            "nota_id": nota_id,
            "ordem_sap": ordem_sap,
            "ordem_gerada": ordem_gerada,
            "ordem_candidata": ordem_candidata,
            "ordem_candidata_norm": ordem_candidata_norm,
            "status": status_norm,
            "descricao": _as_clean_text(row.get("descricao")),
            "centro": _normalize_centro(row.get("centro")) or _as_clean_text(row.get("centro")),
            "administrador_id": _as_clean_text(row.get("administrador_id")),
            "data_criacao_sap": _normalize_iso_date(row.get("data_criacao_sap")),
            "status_sap": status_sap,
            "tem_qmel": numero_nota_norm in qmel_by_note,
            "status_elegivel": status_elegivel,
            "tem_ordem_vinculada": tem_ordem_vinculada,
            "estado_operacional": estado_operacional,
            "hora_base_utc": hora_base_utc,
            "data_conclusao_sap": _normalize_iso_date(data_conclusao),
            "data_enc_nota_sap": _normalize_iso_date(data_enc_nota),
            "source_updated_at": _normalize_iso_datetime(row.get("updated_at")),
        })

    mestre_present = _fetch_mestre_presence_by_order(list(ordem_candidates_norm))
    pmpl_present = _fetch_pmpl_presence_by_order(spark, list(ordem_lookup_values))

    payload: list[dict] = []
    metrics = {
        "total_rows": 0,
        "eligible_rows": 0,
        "missing_pmpl": 0,
        "missing_mestre": 0,
        "has_order_linked": 0,
        "invalid_status": 0,
        "total_com_ordem": 0,
        "total_encerrada_sem_ordem": 0,
        "total_aguardando_convergencia": 0,
        "total_cancelada": 0,
        "estado_operacional_counts": {k: 0 for k in COCKPIT_ESTADO_OPERACIONAL_VALUES},
    }

    for row in base_rows:
        ordem_candidata_norm = row.get("ordem_candidata_norm")
        tem_pmpl = bool(ordem_candidata_norm and ordem_candidata_norm in pmpl_present)
        tem_mestre = bool(ordem_candidata_norm and ordem_candidata_norm in mestre_present)
        estado_operacional = row["estado_operacional"]
        eligible_cockpit = estado_operacional == "COCKPIT_PENDENTE"
        reason_not_eligible, reason_codes = _build_not_eligible_reasons(
            estado_operacional=estado_operacional,
            eligible_cockpit=eligible_cockpit,
            tem_ordem_vinculada=row["tem_ordem_vinculada"],
            status_elegivel=row["status_elegivel"],
            tem_qmel=row["tem_qmel"],
            tem_pmpl=tem_pmpl,
            tem_mestre=tem_mestre,
        )

        item = {
            "numero_nota": row["numero_nota"],
            "numero_nota_norm": row["numero_nota_norm"],
            "nota_id": row["nota_id"],
            "ordem_sap": row["ordem_sap"],
            "ordem_gerada": row["ordem_gerada"],
            "ordem_candidata": row["ordem_candidata"],
            "ordem_candidata_norm": ordem_candidata_norm,
            "status": row["status"],
            "estado_operacional": estado_operacional,
            "descricao": row["descricao"],
            "centro": row["centro"],
            "administrador_id": row["administrador_id"],
            "data_criacao_sap": row["data_criacao_sap"],
            "tem_qmel": row["tem_qmel"],
            "tem_pmpl": tem_pmpl,
            "tem_mestre": tem_mestre,
            "status_elegivel": row["status_elegivel"],
            "tem_ordem_vinculada": row["tem_ordem_vinculada"],
            "eligible_cockpit": eligible_cockpit,
            "reason_not_eligible": reason_not_eligible,
            "reason_codes": reason_codes,
            "source_updated_at": row["source_updated_at"],
        }
        payload.append(item)

        metrics["total_rows"] += 1
        metrics["estado_operacional_counts"][estado_operacional] = (
            metrics["estado_operacional_counts"].get(estado_operacional, 0) + 1
        )
        if item["eligible_cockpit"]:
            metrics["eligible_rows"] += 1
        if not item["tem_pmpl"]:
            metrics["missing_pmpl"] += 1
        if not item["tem_mestre"]:
            metrics["missing_mestre"] += 1
        if item["tem_ordem_vinculada"]:
            metrics["has_order_linked"] += 1
        if not item["status_elegivel"]:
            metrics["invalid_status"] += 1
        if estado_operacional == "COM_ORDEM":
            metrics["total_com_ordem"] += 1
        elif estado_operacional == "ENCERRADA_SEM_ORDEM":
            metrics["total_encerrada_sem_ordem"] += 1
        elif estado_operacional == "AGUARDANDO_CONVERGENCIA":
            metrics["total_aguardando_convergencia"] += 1
        elif estado_operacional == "CANCELADA":
            metrics["total_cancelada"] += 1

    logger.info(
        (
            "Convergência cockpit -> total=%s eligible=%s missing_pmpl=%s missing_mestre=%s "
            "has_order_linked=%s invalid_status=%s states=%s com_ordem=%s encerrada_sem_ordem=%s "
            "aguardando_convergencia=%s cancelada=%s"
        ),
        metrics["total_rows"], metrics["eligible_rows"], metrics["missing_pmpl"],
        metrics["missing_mestre"], metrics["has_order_linked"], metrics["invalid_status"],
        metrics["estado_operacional_counts"],
        metrics["total_com_ordem"],
        metrics["total_encerrada_sem_ordem"],
        metrics["total_aguardando_convergencia"],
        metrics["total_cancelada"],
    )
    return payload, metrics


def upsert_cockpit_convergence(sync_id: str, rows: list[dict]) -> tuple[int, int]:
    if not rows:
        return 0, 0

    deduped: dict[str, dict] = {}
    for row in rows:
        numero_nota = _as_clean_text(row.get("numero_nota"))
        if not numero_nota:
            continue
        payload = dict(row)
        payload["numero_nota"] = numero_nota
        payload["sync_id"] = sync_id
        deduped[numero_nota] = payload

    payload_list = list(deduped.values())
    if not payload_list:
        return 0, 0

    existing_numbers: set[str] = set()
    for batch in _iter_batches([row["numero_nota"] for row in payload_list], BATCH_SIZE):
        result = (
            supabase.table(COCKPIT_CONVERGENCE_TABLE)
            .select("numero_nota")
            .in_("numero_nota", batch)
            .execute()
        )
        existing_numbers.update(
            _as_clean_text(item.get("numero_nota"))
            for item in (result.data or [])
            if _as_clean_text(item.get("numero_nota"))
        )

    for batch in _iter_batches(payload_list, COCKPIT_CONVERGENCE_UPSERT_BATCH_SIZE):
        supabase.table(COCKPIT_CONVERGENCE_TABLE).upsert(batch, on_conflict="numero_nota").execute()

    inserted_count = sum(1 for item in payload_list if item["numero_nota"] not in existing_numbers)
    updated_count = len(payload_list) - inserted_count
    logger.info("Convergência cockpit upsert -> inseridas=%s atualizadas=%s total=%s", inserted_count, updated_count, len(payload_list))
    return inserted_count, updated_count


def main():
    spark = SparkSession.builder.getOrCreate()
    current_stage = "init"
    sync_start_date = get_sync_start_date(spark)
    ignore_watermark = should_ignore_watermark(spark)
    pmpl_standalone_window_days = get_pmpl_standalone_window_days(spark)

    convergencia_inseridas = 0
    convergencia_atualizadas = 0
    convergencia_metrics = {
        "total_rows": 0,
        "eligible_rows": 0,
        "missing_pmpl": 0,
        "missing_mestre": 0,
        "has_order_linked": 0,
        "invalid_status": 0,
        "total_com_ordem": 0,
        "total_encerrada_sem_ordem": 0,
        "total_aguardando_convergencia": 0,
        "total_cancelada": 0,
        "estado_operacional_counts": {k: 0 for k in COCKPIT_ESTADO_OPERACIONAL_VALUES},
    }
    convergencia_status = "not_run"
    convergencia_error: str | None = None
    pmpl_standalone_inseridas = 0
    pmpl_standalone_atualizadas = 0

    try:
        current_stage = "supabase_healthcheck"
        supabase.table("sync_log").select("id").limit(1).execute()
        logger.info("Conexão com Supabase OK.")
    except Exception as e:
        logger.error("FALHA na conexão com Supabase: %s", e)
        raise

    sync_id = create_sync_log(spark)
    logger.info("Sync heavy iniciado: %s", sync_id)

    try:
        current_stage = "read_standalone_pmpl_orders"
        standalone_orders = read_standalone_pmpl_orders(
            spark,
            pmpl_standalone_window_days,
            sync_start_date,
            ignore_watermark=ignore_watermark,
        )

        current_stage = "push_standalone_pmpl_orders"
        _, pmpl_standalone_inseridas, pmpl_standalone_atualizadas = push_standalone_pmpl_orders(sync_id, standalone_orders)

        try:
            convergence_rows, convergencia_metrics = build_cockpit_convergence_dataset(spark)
            convergencia_inseridas, convergencia_atualizadas = upsert_cockpit_convergence(sync_id, convergence_rows)
            convergencia_status = "success"
        except Exception as convergencia_exc:
            if _is_statement_timeout_error(convergencia_exc):
                convergencia_status = "error_tolerated"
                convergencia_error = f"{type(convergencia_exc).__name__}: {convergencia_exc}"
                logger.warning("Timeout na convergência do cockpit (57014). Pulando. erro=%s", convergencia_error)
            else:
                raise

        metadata = {
            "job": "heavy",
            "sync_start_date": sync_start_date,
            "ignore_watermark": ignore_watermark,
            "pmpl_standalone_window_days": pmpl_standalone_window_days,
            "pmpl_standalone_inseridas": pmpl_standalone_inseridas,
            "pmpl_standalone_atualizadas": pmpl_standalone_atualizadas,
            "convergencia_total_rows": convergencia_metrics["total_rows"],
            "convergencia_eligible_rows": convergencia_metrics["eligible_rows"],
            "convergencia_missing_pmpl": convergencia_metrics["missing_pmpl"],
            "convergencia_missing_mestre": convergencia_metrics["missing_mestre"],
            "convergencia_has_order_linked": convergencia_metrics["has_order_linked"],
            "convergencia_invalid_status": convergencia_metrics["invalid_status"],
            "convergencia_total_com_ordem": convergencia_metrics["total_com_ordem"],
            "convergencia_total_encerrada_sem_ordem": convergencia_metrics["total_encerrada_sem_ordem"],
            "convergencia_total_aguardando_convergencia": convergencia_metrics["total_aguardando_convergencia"],
            "convergencia_total_cancelada": convergencia_metrics["total_cancelada"],
            "estado_operacional_counts": convergencia_metrics["estado_operacional_counts"],
            "convergencia_inseridas": convergencia_inseridas,
            "convergencia_atualizadas": convergencia_atualizadas,
            "convergencia_status": convergencia_status,
            "convergencia_error": convergencia_error,
        }

        current_stage = "finalize_sync_log_success"
        try:
            finalize_sync_log(sync_id, read_count=0, inserted=convergencia_inseridas, updated=convergencia_atualizadas, distributed=0, metadata=metadata)
        except Exception as finalize_exc:
            if _is_statement_timeout_error(finalize_exc):
                logger.warning("Timeout ao finalizar sync_log (57014). erro=%s", f"{type(finalize_exc).__name__}: {finalize_exc}")
            else:
                raise

        logger.info("Sync heavy concluido com sucesso")

    except Exception as e:
        logger.error("Sync heavy falhou na etapa '%s': %s: %s", current_stage, type(e).__name__, e)
        try:
            finalize_sync_log(
                sync_id, read_count=0, inserted=0, updated=0, distributed=0,
                metadata={"job": "heavy", "sync_start_date": sync_start_date, "convergencia_status": convergencia_status},
                error=str(e),
            )
        except Exception:
            logger.error("Não conseguiu gravar erro no sync_log")
        raise


main()
