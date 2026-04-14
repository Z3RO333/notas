"""Databricks entrypoint: heavy sync for references, enrichment, and backfill."""

import importlib
import logging
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4


def _ensure_runtime_dependency(package_name: str, module_name: str | None = None) -> None:
    target_module = module_name or package_name
    try:
        importlib.import_module(target_module)
    except ModuleNotFoundError:
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", package_name])
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                f"Nao foi possivel instalar a dependencia '{package_name}' em runtime. "
                "Anexe a biblioteca ao cluster/job Databricks ou habilite pip install no ambiente."
            ) from exc


from pyspark.sql import SparkSession


SUPABASE_URL = dbutils.secrets.get(scope="cockpit", key="SUPABASE_URL")
SUPABASE_SERVICE_KEY = dbutils.secrets.get(scope="cockpit", key="SUPABASE_SERVICE_ROLE_KEY")
PMPL_TABLE = "manutencao.gold.pmpl_pmos"
ORDERS_DOCUMENT_SOURCE_TABLE = "manutencao.silver.mestre_dados_ordem"
ORDERS_MAINTENANCE_SOURCE_TABLE = "manutencao.silver.selecao_ordens_manutencao"

BATCH_SIZE = 100
ORDERS_DOCUMENT_UPSERT_BATCH_SIZE = 500
ORDERS_MAINTENANCE_UPSERT_BATCH_SIZE = 500
ORDERS_MAINTENANCE_EXTRACTION_COLUMN = "DATA_EXTRACAO"
ORDERS_MAINTENANCE_ORDER_COLUMN = "ORDEM"
ORDERS_MAINTENANCE_NOTE_COLUMN = "NOTA"
ORDERS_MAINTENANCE_TYPE_COLUMN = "TIPO_ORDEM"
ORDERS_MAINTENANCE_TEXT_COLUMN = "TEXTO_BREVE"
ORDERS_MAINTENANCE_CENTER_COLUMN = "CENTRO_LIBERACAO"
ORDERS_DOCUMENT_ORDER_COLUMN = "ORDEM"
ORDERS_DOCUMENT_TYPE_COLUMN = "TIPO_DOCUMENTO_VENDAS"
ORDERS_REF_V2_RUNTIME_STATE_TABLE = "sync_job_runtime_state"

JOB_NAME = "heavy"

# Config local deste notebook/arquivo.
HEAVY_SYNC_START_DATE = "2026-01-01"
HEAVY_ORDERS_REF_V2_LOOKBACK_DAYS = 2
HEAVY_ORDERS_REF_V2_TOLERATED_FAILURES = 3
HEAVY_RUN_COCKPIT_SYNC = True

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_job_heavy")


def _as_clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _normalize_ordem_codigo(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    if re.fullmatch(r"\d+(\.0+)?", text):
        integer_part = text.split(".", maxsplit=1)[0]
        normalized = integer_part.lstrip("0")
        return normalized or "0"
    return text


def _normalize_numero_nota(value) -> str | None:
    return _normalize_ordem_codigo(value)


def _normalize_tipo_documento_vendas(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    normalized = text.upper()
    if normalized in {"PMOS", "PMPL"}:
        return normalized
    return None


def _normalize_tipo_ordem(value) -> str | None:
    return _normalize_tipo_documento_vendas(value)


def _normalize_centro(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    if re.fullmatch(r"\d+(\.0+)?", text):
        integer_part = text.split(".", maxsplit=1)[0]
        normalized = integer_part.lstrip("0")
        return normalized or "0"
    return text


def _normalize_iso_date(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    candidate = text[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
        return None
    try:
        date.fromisoformat(candidate)
    except ValueError:
        return None
    return candidate


def _normalize_iso_datetime(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        parsed = None
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%d/%m/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M",
            "%Y-%m-%d",
            "%d/%m/%Y",
        ):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat()


def _extract_single_rpc_row(result, default=None):
    data = result.data
    if isinstance(data, list):
        if not data:
            return {} if default is None else default
        first = data[0]
        return first if isinstance(first, dict) else ({} if default is None else default)
    if isinstance(data, dict):
        return data
    return {} if default is None else default


def _is_statement_timeout_error(error: Exception) -> bool:
    text = str(error).lower()
    return "statement timeout" in text and ("57014" in text or "canceling statement due to statement timeout" in text)


def _calculate_maintenance_reference_completeness(candidate: dict) -> int:
    score = 0
    if candidate.get("tipo_ordem"):
        score += 1
    if candidate.get("texto_breve"):
        score += 1
    if candidate.get("centro_liberacao"):
        score += 1
    if candidate.get("numero_nota_norm"):
        score += 1
    return score


def _is_better_maintenance_reference(current: dict, candidate: dict) -> bool:
    current_score = int(current.get("completeness_score") or 0)
    candidate_score = int(candidate.get("completeness_score") or 0)
    if candidate_score != current_score:
        return candidate_score > current_score
    current_extraction = _as_clean_text(current.get("data_extracao"))
    candidate_extraction = _as_clean_text(candidate.get("data_extracao"))
    if candidate_extraction and current_extraction:
        return candidate_extraction > current_extraction
    if candidate_extraction and not current_extraction:
        return True
    return False


def _resolve_existing_columns(spark: SparkSession, table_name: str, candidates: list[str]) -> list[str]:
    existing_map = {col.upper(): col for col in spark.table(table_name).columns}
    resolved: list[str] = []
    for candidate in candidates:
        found = existing_map.get(candidate.upper())
        if found:
            resolved.append(found)
    return resolved


def _build_date_expr_from_columns(columns: list[str]) -> str:
    if not columns:
        return "NULL"
    parts: list[str] = []
    for col in columns:
        parts.extend([
            f"to_date({col})",
            f"to_date(cast({col} as string), 'yyyy-MM-dd')",
            f"to_date(cast({col} as string), 'yyyyMMdd')",
            f"to_date(cast({col} as string), 'dd/MM/yyyy')",
        ])
    return "coalesce(" + ", ".join(parts) + ")"


def _build_orders_maintenance_data_extracao_expr(spark: SparkSession) -> str:
    existing = _resolve_existing_columns(spark, ORDERS_MAINTENANCE_SOURCE_TABLE, [ORDERS_MAINTENANCE_EXTRACTION_COLUMN])
    return _build_date_expr_from_columns(existing)


def _ensure_supabase_healthcheck() -> None:
    supabase.table("sync_log").select("id").limit(1).execute()


def create_sync_log(spark: SparkSession, metadata: dict | None = None) -> str:
    sync_id = str(uuid4())
    job_id = spark.conf.get("spark.databricks.job.runId", "manual")
    payload = {"id": sync_id, "status": "running", "databricks_job_id": str(job_id)}
    if metadata:
        payload["metadata"] = metadata
    supabase.table("sync_log").insert(payload).execute()
    return sync_id


def finalize_sync_log(
    sync_id: str,
    read_count: int,
    inserted: int,
    updated: int,
    distributed: int,
    metadata: dict | None = None,
    error: str | None = None,
):
    data = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "status": "error" if error else "success",
        "notas_lidas": read_count,
        "notas_inseridas": inserted,
        "notas_atualizadas": updated,
        "notas_distribuidas": distributed,
    }
    if metadata:
        data["metadata"] = metadata
    if error:
        data["erro_mensagem"] = error[:2000]
    supabase.table("sync_log").update(data).eq("id", sync_id).execute()


def get_orders_ref_v2_watermark() -> str | None:
    result = (
        supabase.table("ordens_manutencao_referencia")
        .select("last_seen_at")
        .not_.is_("last_seen_at", "null")
        .order("last_seen_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data and result.data[0].get("last_seen_at"):
        return result.data[0]["last_seen_at"]
    return None


def get_orders_ref_v2_failure_streak() -> int:
    result = (
        supabase.table(ORDERS_REF_V2_RUNTIME_STATE_TABLE)
        .select("orders_ref_v2_failure_streak")
        .eq("job_name", JOB_NAME)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return 0
    try:
        return max(int(rows[0].get("orders_ref_v2_failure_streak") or 0), 0)
    except (TypeError, ValueError):
        return 0


def set_orders_ref_v2_failure_streak(streak: int, error_message: str | None):
    payload = {
        "job_name": JOB_NAME,
        "orders_ref_v2_failure_streak": max(int(streak), 0),
        "last_error": (error_message or "")[:2000] or None,
    }
    supabase.table(ORDERS_REF_V2_RUNTIME_STATE_TABLE).upsert(payload, on_conflict="job_name").execute()


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
    return references, {
        "total_rows": len(rows),
        "valid_rows": len(references),
        "invalid_order": invalid_order,
        "invalid_type": invalid_type,
        "conflicts": conflicts,
    }


def upsert_orders_document_reference(sync_id: str, references: list[dict]) -> tuple[int, int]:
    if not references:
        return 0, 0

    existing_orders: set[str] = set()
    ordem_codes = [item["ordem_codigo_norm"] for item in references]
    for i in range(0, len(ordem_codes), BATCH_SIZE):
        batch = ordem_codes[i:i + BATCH_SIZE]
        result = (
            supabase.table("ordens_tipo_documento_referencia")
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
            "tipo_documento_vendas": item["tipo_documento_vendas"],
            "fonte": ORDERS_DOCUMENT_SOURCE_TABLE,
            "last_sync_id": sync_id,
            "last_seen_at": now_iso,
        }
        for item in references
    ]
    for i in range(0, len(payload), ORDERS_DOCUMENT_UPSERT_BATCH_SIZE):
        batch = payload[i:i + ORDERS_DOCUMENT_UPSERT_BATCH_SIZE]
        supabase.table("ordens_tipo_documento_referencia").upsert(batch, on_conflict="ordem_codigo_norm").execute()

    inserted_count = sum(1 for item in references if item["ordem_codigo_norm"] not in existing_orders)
    updated_count = len(references) - inserted_count
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
    df = spark.sql(f"""
        WITH pmpl_criado AS (
          SELECT ORDEM AS PMPL_ORDEM, MAX(CRIADOR_POR) AS CRIADO_POR
          FROM {PMPL_TABLE}
          WHERE CRIADOR_POR IS NOT NULL
          GROUP BY ORDEM
        )
        SELECT
          {ORDERS_MAINTENANCE_ORDER_COLUMN} AS ORDEM,
          {ORDERS_MAINTENANCE_NOTE_COLUMN} AS NOTA,
          {ORDERS_MAINTENANCE_TYPE_COLUMN} AS TIPO_ORDEM,
          {ORDERS_MAINTENANCE_TEXT_COLUMN} AS TEXTO_BREVE,
          {ORDERS_MAINTENANCE_CENTER_COLUMN} AS CENTRO_LIBERACAO,
          {data_extracao_expr} AS DATA_EXTRACAO,
          pmpl_criado.CRIADO_POR AS CRIADO_POR
        FROM {ORDERS_MAINTENANCE_SOURCE_TABLE}
        LEFT JOIN pmpl_criado ON pmpl_criado.PMPL_ORDEM = {ORDERS_MAINTENANCE_ORDER_COLUMN}
        WHERE {ORDERS_MAINTENANCE_ORDER_COLUMN} IS NOT NULL
          AND ({data_extracao_expr} >= date('{effective_start}') OR {data_extracao_expr} IS NULL)
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
            "criado_por_sap_codigo": _as_clean_text(row_dict.get("CRIADO_POR")),
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
            "criado_por_sap_codigo": item.get("criado_por_sap_codigo"),
        }
        for item in by_order.values()
    ]

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
            "criado_por_sap_codigo": item.get("criado_por_sap_codigo"),
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
    return inserted_count, updated_count


def run_orders_maintenance_reference_enrichment() -> dict:
    result = supabase.rpc("enriquecer_ordens_por_referencia_manutencao", {}).execute()
    row = _extract_single_rpc_row(result)
    return {
        "ordens_atualizadas_total": int(row.get("ordens_atualizadas_total") or 0),
        "tipo_ordem_atualizadas": int(row.get("tipo_ordem_atualizadas") or 0),
        "centro_preenchidos": int(row.get("centro_preenchidos") or 0),
        "numero_nota_preenchidas": int(row.get("numero_nota_preenchidas") or 0),
    }


def run_tipo_ordem_reference_enrichment() -> dict:
    try:
        result = supabase.rpc("enriquecer_tipo_ordem_por_referencia", {}).execute()
    except Exception as exc:
        if _is_statement_timeout_error(exc):
            return {
                "status": "error_tolerated",
                "tipo_enriquecidas": 0,
                "error": f"{type(exc).__name__}: {exc}",
            }
        raise
    row = _extract_single_rpc_row(result, default=0)
    if isinstance(row, dict):
        tipo_enriquecidas = int(row.get("tipo_enriquecidas") or row.get("total") or 0)
    else:
        tipo_enriquecidas = int(row or 0)
    return {"status": "success", "tipo_enriquecidas": tipo_enriquecidas, "error": None}


def run_backfill_and_register_v2(sync_id: str) -> dict:
    metrics = {
        "status": "not_run",
        "backfill_notas_atualizadas": 0,
        "ordens_detectadas": 0,
        "notas_auto_concluidas": 0,
        "error": None,
    }
    try:
        bf = supabase.rpc("backfill_ordem_sap_de_referencia", {"p_sync_id": sync_id}).execute()
        bf_raw = bf.data
        if isinstance(bf_raw, list):
            bf_raw = bf_raw[0] if bf_raw else {}
        if not isinstance(bf_raw, dict):
            bf_raw = {}
        metrics["backfill_notas_atualizadas"] = int(bf_raw.get("notas_atualizadas") or 0)

        reg = supabase.rpc("registrar_ordens_por_notas", {"p_sync_id": sync_id}).execute()
        reg_raw = reg.data
        if isinstance(reg_raw, list):
            reg_raw = reg_raw[0] if reg_raw else {}
        if not isinstance(reg_raw, dict):
            reg_raw = {}
        metrics["ordens_detectadas"] = int(reg_raw.get("ordens_detectadas") or 0)
        metrics["notas_auto_concluidas"] = int(reg_raw.get("notas_auto_concluidas") or 0)
        metrics["status"] = "success"
    except Exception as exc:
        metrics["status"] = "error_tolerated"
        metrics["error"] = f"{type(exc).__name__}: {exc}"
    return metrics


def run_cockpit_convergencia_sync(sync_id: str) -> dict:
    try:
        result = supabase.rpc("sincronizar_cockpit_convergencia", {"p_sync_id": sync_id}).execute()
        raw = result.data
        if isinstance(raw, list):
            raw = raw[0] if raw else {}
        if not isinstance(raw, dict):
            raw = {}
        return {
            "status": "success",
            "inseridas": int(raw.get("inseridas") or 0),
            "atualizadas": int(raw.get("atualizadas") or 0),
            "total_elegiveis": int(raw.get("total_elegiveis") or 0),
            "error": None,
        }
    except Exception as exc:
        return {
            "status": "error_tolerated",
            "inseridas": 0,
            "atualizadas": 0,
            "total_elegiveis": 0,
            "error": f"{type(exc).__name__}: {exc}",
        }


def main() -> None:
    spark = SparkSession.builder.getOrCreate()
    _ensure_runtime_dependency("supabase")
    from supabase import create_client
    global supabase
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    current_step = "startup"
    ordens_tipo_ref_inseridas = 0
    ordens_tipo_ref_atualizadas = 0
    ordens_ref_v2_inseridas = 0
    ordens_ref_v2_atualizadas = 0

    orders_document_metrics: dict[str, object] = {
        "total_rows": 0,
        "valid_rows": 0,
        "invalid_order": 0,
        "invalid_type": 0,
        "conflicts": 0,
    }
    tipo_ordem_enrichment_metrics: dict[str, object] = {
        "status": "not_run",
        "tipo_enriquecidas": 0,
        "error": None,
    }
    orders_ref_v2_metrics: dict[str, object] = {
        "total_rows": 0,
        "valid_rows": 0,
        "invalid_order": 0,
        "invalid_type": 0,
        "dedupe_replaced": 0,
        "dedupe_discarded": 0,
        "effective_start": None,
        "watermark": None,
    }
    orders_ref_v2_enrichment_metrics: dict[str, object] = {
        "ordens_atualizadas_total": 0,
        "tipo_ordem_atualizadas": 0,
        "centro_preenchidos": 0,
        "numero_nota_preenchidas": 0,
    }
    orders_ref_v2_status = "not_run"
    orders_ref_v2_failure_streak = 0
    orders_ref_v2_error: str | None = None
    backfill_v2_metrics: dict[str, object] = {
        "status": "not_run",
        "backfill_notas_atualizadas": 0,
        "ordens_detectadas": 0,
        "notas_auto_concluidas": 0,
        "error": None,
    }
    cockpit_sync_metrics: dict[str, object] = {
        "status": "not_run",
        "inseridas": 0,
        "atualizadas": 0,
        "total_elegiveis": 0,
        "error": None,
    }

    _ensure_supabase_healthcheck()
    sync_id = create_sync_log(spark, metadata={"job": JOB_NAME})

    try:
        current_step = "read_orders_document_reference"
        orders_document_reference, orders_document_metrics = read_orders_document_reference(spark)

        current_step = "upsert_orders_document_reference"
        ordens_tipo_ref_inseridas, ordens_tipo_ref_atualizadas = upsert_orders_document_reference(
            sync_id,
            orders_document_reference,
        )

        current_step = "run_tipo_ordem_reference_enrichment"
        tipo_ordem_enrichment_metrics = run_tipo_ordem_reference_enrichment()

        try:
            current_step = "read_orders_maintenance_reference"
            orders_ref_v2_reference, orders_ref_v2_metrics = read_orders_maintenance_reference(
                spark,
                sync_start_date=HEAVY_SYNC_START_DATE,
                lookback_days=HEAVY_ORDERS_REF_V2_LOOKBACK_DAYS,
            )

            current_step = "upsert_orders_maintenance_reference"
            ordens_ref_v2_inseridas, ordens_ref_v2_atualizadas = upsert_orders_maintenance_reference(
                sync_id,
                orders_ref_v2_reference,
            )

            try:
                current_step = "run_orders_maintenance_reference_enrichment"
                orders_ref_v2_enrichment_metrics = run_orders_maintenance_reference_enrichment()
                orders_ref_v2_status = "success"
                orders_ref_v2_failure_streak = 0
                orders_ref_v2_error = None
                set_orders_ref_v2_failure_streak(0, None)
            except Exception as exc:
                if _is_statement_timeout_error(exc):
                    orders_ref_v2_status = "error_tolerated"
                    orders_ref_v2_failure_streak = 0
                    orders_ref_v2_error = f"{type(exc).__name__}: {exc}"
                    set_orders_ref_v2_failure_streak(0, orders_ref_v2_error)
                else:
                    raise
        except Exception as exc:
            previous_streak = get_orders_ref_v2_failure_streak()
            orders_ref_v2_failure_streak = previous_streak + 1
            orders_ref_v2_error = f"{type(exc).__name__}: {exc}"
            orders_ref_v2_status = "error_tolerated"
            set_orders_ref_v2_failure_streak(orders_ref_v2_failure_streak, orders_ref_v2_error)
            if orders_ref_v2_failure_streak > HEAVY_ORDERS_REF_V2_TOLERATED_FAILURES:
                raise RuntimeError(
                    "Falha recorrente na referencia v2 de manutencao "
                    f"por {orders_ref_v2_failure_streak} ciclos consecutivos."
                ) from exc

        current_step = "run_backfill_and_register_v2"
        backfill_v2_metrics = run_backfill_and_register_v2(sync_id)

        if HEAVY_RUN_COCKPIT_SYNC:
            current_step = "run_cockpit_convergencia_sync"
            cockpit_sync_metrics = run_cockpit_convergencia_sync(sync_id)

        finalize_sync_log(
            sync_id,
            read_count=0,
            inserted=0,
            updated=0,
            distributed=0,
            metadata={
                "job": JOB_NAME,
                "current_step": current_step,
                "sync_start_date": HEAVY_SYNC_START_DATE,
                "orders_document_source_table": ORDERS_DOCUMENT_SOURCE_TABLE,
                "orders_maintenance_source_table": ORDERS_MAINTENANCE_SOURCE_TABLE,
                "orders_ref_v2_lookback_days": HEAVY_ORDERS_REF_V2_LOOKBACK_DAYS,
                "orders_ref_v2_tolerated_failures": HEAVY_ORDERS_REF_V2_TOLERATED_FAILURES,
                "ordens_tipo_ref_total_rows": orders_document_metrics["total_rows"],
                "ordens_tipo_ref_valid_rows": orders_document_metrics["valid_rows"],
                "ordens_tipo_ref_invalid_order": orders_document_metrics["invalid_order"],
                "ordens_tipo_ref_invalid_type": orders_document_metrics["invalid_type"],
                "ordens_tipo_ref_conflicts": orders_document_metrics["conflicts"],
                "ordens_tipo_ref_inseridas": ordens_tipo_ref_inseridas,
                "ordens_tipo_ref_atualizadas": ordens_tipo_ref_atualizadas,
                "tipo_ordem_enrichment_status": tipo_ordem_enrichment_metrics.get("status"),
                "tipo_ordem_enrichment_error": tipo_ordem_enrichment_metrics.get("error"),
                "tipo_ordem_enriquecidas": tipo_ordem_enrichment_metrics.get("tipo_enriquecidas"),
                "orders_ref_v2_status": orders_ref_v2_status,
                "orders_ref_v2_failure_streak": orders_ref_v2_failure_streak,
                "orders_ref_v2_error": orders_ref_v2_error,
                "orders_ref_v2_total_rows": orders_ref_v2_metrics["total_rows"],
                "orders_ref_v2_valid_rows": orders_ref_v2_metrics["valid_rows"],
                "orders_ref_v2_invalid_order": orders_ref_v2_metrics["invalid_order"],
                "orders_ref_v2_invalid_type": orders_ref_v2_metrics["invalid_type"],
                "orders_ref_v2_dedupe_replaced": orders_ref_v2_metrics["dedupe_replaced"],
                "orders_ref_v2_dedupe_discarded": orders_ref_v2_metrics["dedupe_discarded"],
                "orders_ref_v2_effective_start": orders_ref_v2_metrics["effective_start"],
                "orders_ref_v2_watermark": orders_ref_v2_metrics["watermark"],
                "orders_ref_v2_inseridas": ordens_ref_v2_inseridas,
                "orders_ref_v2_atualizadas": ordens_ref_v2_atualizadas,
                "orders_ref_v2_ordens_atualizadas_total": orders_ref_v2_enrichment_metrics["ordens_atualizadas_total"],
                "orders_ref_v2_tipo_ordem_atualizadas": orders_ref_v2_enrichment_metrics["tipo_ordem_atualizadas"],
                "orders_ref_v2_centro_preenchidos": orders_ref_v2_enrichment_metrics["centro_preenchidos"],
                "orders_ref_v2_numero_nota_preenchidas": orders_ref_v2_enrichment_metrics["numero_nota_preenchidas"],
                "backfill_v2_status": backfill_v2_metrics.get("status"),
                "backfill_v2_notas_atualizadas": backfill_v2_metrics.get("backfill_notas_atualizadas"),
                "backfill_v2_ordens_detectadas": backfill_v2_metrics.get("ordens_detectadas"),
                "backfill_v2_auto_concluidas": backfill_v2_metrics.get("notas_auto_concluidas"),
                "backfill_v2_error": backfill_v2_metrics.get("error"),
                "cockpit_sync_status": cockpit_sync_metrics.get("status"),
                "cockpit_sync_inseridas": cockpit_sync_metrics.get("inseridas"),
                "cockpit_sync_atualizadas": cockpit_sync_metrics.get("atualizadas"),
                "cockpit_sync_total_elegiveis": cockpit_sync_metrics.get("total_elegiveis"),
                "cockpit_sync_error": cockpit_sync_metrics.get("error"),
            },
        )
    except Exception as exc:
        finalize_sync_log(
            sync_id,
            read_count=0,
            inserted=0,
            updated=0,
            distributed=0,
            metadata={
                "job": JOB_NAME,
                "current_step": current_step,
                "sync_start_date": HEAVY_SYNC_START_DATE,
                "orders_document_source_table": ORDERS_DOCUMENT_SOURCE_TABLE,
                "orders_maintenance_source_table": ORDERS_MAINTENANCE_SOURCE_TABLE,
                "orders_ref_v2_lookback_days": HEAVY_ORDERS_REF_V2_LOOKBACK_DAYS,
                "orders_ref_v2_tolerated_failures": HEAVY_ORDERS_REF_V2_TOLERATED_FAILURES,
                "ordens_tipo_ref_inseridas": ordens_tipo_ref_inseridas,
                "ordens_tipo_ref_atualizadas": ordens_tipo_ref_atualizadas,
                "tipo_ordem_enrichment_status": tipo_ordem_enrichment_metrics.get("status"),
                "tipo_ordem_enrichment_error": tipo_ordem_enrichment_metrics.get("error"),
                "orders_ref_v2_status": orders_ref_v2_status,
                "orders_ref_v2_failure_streak": orders_ref_v2_failure_streak,
                "orders_ref_v2_error": orders_ref_v2_error,
                "orders_ref_v2_inseridas": ordens_ref_v2_inseridas,
                "orders_ref_v2_atualizadas": ordens_ref_v2_atualizadas,
                "backfill_v2_status": backfill_v2_metrics.get("status"),
                "backfill_v2_error": backfill_v2_metrics.get("error"),
                "cockpit_sync_status": cockpit_sync_metrics.get("status"),
                "cockpit_sync_error": cockpit_sync_metrics.get("error"),
            },
            error=str(exc),
        )
        raise


if __name__ == "__main__":
    main()
