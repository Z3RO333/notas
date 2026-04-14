"""Databricks entrypoint: fast sync for notes, distribution, and cockpit."""

import importlib
import logging
import re
import subprocess
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
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
PRIMARY_NOTES_SOURCE_TABLE = "manutencao.gold.vw_notas_base_latest"
NOTES_SOURCE_FALLBACK_TABLES = (
    "manutencao.streaming.notas_qm",
)
STREAMING_TABLE = PRIMARY_NOTES_SOURCE_TABLE

MAX_WATERMARK_FUTURE_DAYS = 1
BOOTSTRAP_CHECKPOINT_SCAN_LIMIT = 500
BATCH_SIZE = 100
SAP_STATUS_AUX_BATCH_SIZE = 500

SAP_STATUS_AUX_CANONICAL_PRIORITY = {
    "VIROU_ORDEM": 4,
    "CANCELADA": 3,
    "ABERTA": 2,
    "INDEFINIDA": 1,
}
SAP_STATUS_AUX_NOTA_COLUMNS_CANDIDATES = [
    "NOTA",
    "NUMERO_NOTA",
    "NUMERO_DA_NOTA",
    "NUM_NOTA",
    "NOTIFICACAO",
    "NOTIFICACAO_QM",
    "QMNUM",
]
SAP_STATUS_AUX_STATUS_COLUMNS_CANDIDATES = [
    "STATUS",
    "STATUS_SISTEMA",
    "STATUS_NOTA",
    "STATUS_SAP",
    "SITUACAO",
    "SITUACAO_NOTA",
    "STATUS_OBJ_ADMIN",
]
SAP_STATUS_AUX_EXPORT_DATE_COLUMNS_CANDIDATES = [
    "DATA_EXPORTACAO",
    "DATA_EXTRACAO",
    "DATA_STATUS",
    "DATA_ATUALIZACAO",
    "DATA",
]
SAP_STATUS_AUX_CANCEL_KEYWORDS = (
    "CANCEL",
    "ENCERR",
    "CONCLU",
    "FECH",
    "ANUL",
    "REJEIT",
)
SAP_STATUS_AUX_OPEN_KEYWORDS = (
    "ABERT",
    "OPEN",
    "PENDEN",
    "ANDAM",
    "TRAT",
    "ENCAMINH",
    "EM_ANALISE",
    "EM_PROCESS",
    "NOVA",
)
SAP_STATUS_AUX_EXACT_STATUS_MAP = {
    "MSPN": "ABERTA",
    "MSEN": "CANCELADA",
    "MSPR_ORDA": "VIROU_ORDEM",
    "MSEN_ORDA": "VIROU_ORDEM",
    "MSIM_MSPR_ORDA": "VIROU_ORDEM",
}
SAP_STATUS_AUX_CANCEL_CODE_HINTS = (
    "NOCO",
    "DLFL",
    "LOEK",
    "CANC",
    "REJE",
)
NOTA_CENTRO_COLUMNS_CANDIDATES = [
    "CENTRO_PARA_CENTRO_TRAB",
    "CENTRO_MATERIAL",
    "CENTRO_LOCALIZACAO",
    "CENTRO",
]
NOTA_UPDATED_AT_COLUMNS_CANDIDATES = [
    "__timestamp",
    "DATA_ATUALIZACAO",
]
NOTA_RECENCY_COLUMNS_CANDIDATES = [
    *NOTA_UPDATED_AT_COLUMNS_CANDIDATES,
    "HORA_MODIFICACAO",
    "HORA_NOTA",
    "DATA_CRIACAO",
    "DATA_ENTRADA",
    "DATA_ABERTURA",
    "DT_CRIACAO",
    "DT_ENTRADA",
]

JOB_NAME = "fast"

# Config local deste notebook/arquivo.
FAST_WINDOW_DAYS = 30
FAST_FORCE_WINDOW = False
FAST_IGNORE_WATERMARK = False
FAST_SYNC_START_DATE = "2026-01-01"
FAST_BOOTSTRAP_MODE = "auto"
FAST_RUN_SAP_STATUS_AUX = True
FAST_SAP_STATUS_AUX_REQUIRED = False
FAST_SAP_STATUS_AUX_PATH = ""
FAST_SAP_STATUS_AUX_FORMAT = "auto"
FAST_SAP_STATUS_AUX_REFRESH_MINUTES = 24 * 60
FAST_SAP_STATUS_AUX_CSV_DELIMITER = ";"
FAST_SAP_STATUS_AUX_XLSX_SHEET = None
FAST_SAP_STATUS_AUX_NOTA_COLUMN = None
FAST_SAP_STATUS_AUX_STATUS_COLUMN = None
FAST_SAP_STATUS_AUX_EXPORT_DATE_COLUMN = None
FAST_COPY_INTENT_TTL_MINUTES = 60
FAST_COPY_INTENT_CONFIRM_REPAIR_MINUTES = 15
FAST_RUN_COCKPIT_SYNC = True

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_job_fast")


def _as_clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _normalize_text_token(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    without_accents = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    collapsed = re.sub(r"[^A-Za-z0-9]+", "_", without_accents).strip("_")
    return collapsed.upper()


def _normalize_centro(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None

    if re.fullmatch(r"\d+(\.0+)?", text):
        integer_part = text.split(".", maxsplit=1)[0]
        normalized = integer_part.lstrip("0")
        return normalized or "0"

    return text


def _extract_centro_from_candidates(row_dict: dict, candidates: list[str]) -> str | None:
    for col in candidates:
        value = _normalize_centro(row_dict.get(col))
        if value:
            return value
    return None


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


def _to_json_serializable(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _to_json_serializable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_json_serializable(item) for item in value]
    return str(value)


def _extract_note_source_timestamp(row_dict: dict) -> str | None:
    for col in NOTA_UPDATED_AT_COLUMNS_CANDIDATES:
        normalized = _normalize_iso_datetime(row_dict.get(col))
        if normalized:
            return normalized
    return None


def _summarize_note_source_columns(spark: SparkSession, source_table: str) -> dict:
    columns = spark.table(source_table).columns
    upper_columns = {col.upper() for col in columns}
    return {
        "source_table": source_table,
        "source_columns_total": len(columns),
        "source_has_centro_para_centro_trab": "CENTRO_PARA_CENTRO_TRAB" in upper_columns,
        "source_has_data_atualizacao": "DATA_ATUALIZACAO" in upper_columns,
        "source_has_hora_modificacao": "HORA_MODIFICACAO" in upper_columns,
        "source_has_hora_nota": "HORA_NOTA" in upper_columns,
        "source_has_status": "STATUS" in upper_columns,
        "source_has_status_obj_admin": "STATUS_OBJ_ADMIN" in upper_columns,
        "source_has_ordem": "ORDEM" in upper_columns,
    }


def _table_exists_for_read(spark: SparkSession, table_name: str) -> bool:
    try:
        spark.table(table_name).columns
        return True
    except Exception:
        return False


def _resolve_notes_source_table(spark: SparkSession) -> str:
    for candidate in (PRIMARY_NOTES_SOURCE_TABLE, *NOTES_SOURCE_FALLBACK_TABLES):
        if _table_exists_for_read(spark, candidate):
            if candidate != PRIMARY_NOTES_SOURCE_TABLE:
                logger.warning(
                    "Fonte primaria %s indisponivel. Usando fallback %s.",
                    PRIMARY_NOTES_SOURCE_TABLE,
                    candidate,
                )
            else:
                logger.info("Fonte de notas resolvida para %s.", candidate)
            return candidate

    candidates = ", ".join((PRIMARY_NOTES_SOURCE_TABLE, *NOTES_SOURCE_FALLBACK_TABLES))
    raise RuntimeError(f"Nenhuma fonte de notas disponivel no Databricks. Candidatas: {candidates}")


def _watermark_is_too_future(iso_date: str, max_future_days: int = MAX_WATERMARK_FUTURE_DAYS) -> bool:
    candidate = date.fromisoformat(iso_date)
    max_allowed = datetime.now(timezone.utc).date() + timedelta(days=max_future_days)
    return candidate > max_allowed


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


def _build_notes_source_recency_date_expr(spark: SparkSession, source_table: str) -> str:
    existing = _resolve_existing_columns(spark, source_table, NOTA_RECENCY_COLUMNS_CANDIDATES)
    if not existing:
        logger.warning(
            "Nenhuma coluna de data candidata encontrada na tabela %s. Candidatas=%s",
            source_table,
            NOTA_RECENCY_COLUMNS_CANDIDATES,
        )
    return _build_date_expr_from_columns(existing)


def _collect_notes_source_range_metrics(
    spark: SparkSession,
    source_table: str,
    source_recency_expr: str,
) -> dict[str, object]:
    try:
        row = spark.sql(f"""
            SELECT
              COUNT(*) AS total_rows,
              MIN({source_recency_expr}) AS min_recency,
              MAX({source_recency_expr}) AS max_recency
            FROM {source_table}
        """).collect()[0]
    except Exception as exc:
        logger.warning("Falha ao coletar range da fonte %s: %s", source_table, exc)
        return {
            "source_total_rows": None,
            "source_min_recency": None,
            "source_max_recency": None,
        }

    return {
        "source_total_rows": int(row["total_rows"] or 0),
        "source_min_recency": str(row["min_recency"]) if row["min_recency"] is not None else None,
        "source_max_recency": str(row["max_recency"]) if row["max_recency"] is not None else None,
    }


def _log_empty_result_diagnostics(
    spark: SparkSession,
    source_table: str,
    effective_start: str,
    source_recency_expr: str,
):
    try:
        summary_row = spark.sql(f"""
            SELECT
              COUNT(*) AS total_rows,
              SUM(CASE WHEN {source_recency_expr} IS NULL THEN 1 ELSE 0 END) AS recency_invalidas,
              MIN({source_recency_expr}) AS min_recency,
              MAX({source_recency_expr}) AS max_recency
            FROM {source_table}
        """).collect()[0]

        filtered_row = spark.sql(f"""
            SELECT COUNT(*) AS total_filtradas
            FROM {source_table}
            WHERE {source_recency_expr} >= date('{effective_start}')
        """).collect()[0]

        sample_rows = [
            row.asDict()
            for row in spark.sql(f"""
                SELECT
                  DATA_CRIACAO,
                  DATA_ATUALIZACAO,
                  NUMERO_NOTA,
                  {source_recency_expr} AS recency_norm
                FROM {source_table}
                ORDER BY {source_recency_expr} DESC, DATA_CRIACAO DESC
                LIMIT 5
            """).collect()
        ]

        logger.warning(
            "Diagnostico source vazio: tabela=%s total_rows=%s invalidas_recencia=%s min_recencia=%s max_recencia=%s total_filtradas=%s effective_start=%s",
            source_table,
            summary_row["total_rows"],
            summary_row["recency_invalidas"],
            summary_row["min_recency"],
            summary_row["max_recency"],
            filtered_row["total_filtradas"],
            effective_start,
        )
        logger.warning("Amostra de recencia da fonte (top 5): %s", sample_rows)
    except Exception as diag_error:
        logger.warning("Falha ao gerar diagnostico de source vazio: %s", diag_error)


def _raise_if_source_result_is_inconsistent(batch_metrics: dict[str, object]) -> None:
    source_rows_read = int(batch_metrics.get("source_rows_read") or 0)
    if source_rows_read > 0:
        return

    source_total_rows = batch_metrics.get("source_total_rows")
    effective_start = _normalize_iso_date(batch_metrics.get("source_effective_start"))
    source_max_recency = _normalize_iso_date(batch_metrics.get("source_max_recency"))

    if source_total_rows is None or not effective_start or not source_max_recency:
        return

    if int(source_total_rows) <= 0:
        return

    if source_max_recency >= effective_start:
        raise RuntimeError(
            "Fonte retornou zero linhas para o recorte atual apesar de possuir dados elegiveis. "
            f"source_table={batch_metrics.get('source_table')} effective_start={effective_start} "
            f"source_max_recency={source_max_recency} source_total_rows={source_total_rows}"
        )


def _ensure_supabase_healthcheck() -> None:
    try:
        supabase.table("sync_log").select("id").limit(1).execute()
        logger.info("Conexao com Supabase OK. sync_log acessivel.")
    except Exception as exc:
        logger.error("FALHA na conexao com Supabase: %s", exc)
        logger.error("URL: %s", SUPABASE_URL)
        logger.error("Verifique se esta usando a SERVICE_ROLE_KEY (nao a anon key)")
        raise


def create_sync_log(spark: SparkSession, metadata: dict | None = None) -> str:
    sync_id = str(uuid4())
    job_id = spark.conf.get("spark.databricks.job.runId", "manual")
    payload = {
        "id": sync_id,
        "status": "running",
        "databricks_job_id": str(job_id),
    }
    if metadata:
        payload["metadata"] = metadata
    supabase.table("sync_log").insert(payload).execute()
    return sync_id


def get_watermark() -> str | None:
    streaming_result = (
        supabase.table("notas_manutencao")
        .select("streaming_timestamp")
        .not_.is_("streaming_timestamp", "null")
        .order("streaming_timestamp", desc=True)
        .limit(1)
        .execute()
    )
    if streaming_result.data and streaming_result.data[0].get("streaming_timestamp"):
        return streaming_result.data[0]["streaming_timestamp"]

    result = (
        supabase.table("notas_manutencao")
        .select("data_criacao_sap")
        .not_.is_("data_criacao_sap", "null")
        .order("data_criacao_sap", desc=True)
        .limit(1)
        .execute()
    )
    if result.data and result.data[0].get("data_criacao_sap"):
        return result.data[0]["data_criacao_sap"]
    return None


def has_bootstrap_checkpoint(source_table: str, sync_start_date: str) -> bool:
    result = (
        supabase.table("sync_log")
        .select("status, metadata")
        .eq("status", "success")
        .order("started_at", desc=True)
        .limit(BOOTSTRAP_CHECKPOINT_SCAN_LIMIT)
        .execute()
    )

    for row in (result.data or []):
        metadata = row.get("metadata")
        if not isinstance(metadata, dict):
            continue
        if (
            metadata.get("full_bootstrap") is True
            and metadata.get("streaming_table") == source_table
            and metadata.get("sync_start_date") == sync_start_date
        ):
            return True

    return False


def should_run_full_bootstrap(bootstrap_mode: str, source_table: str, sync_start_date: str) -> bool:
    if bootstrap_mode == "force":
        logger.info("Bootstrap forcado por config local.")
        return True
    if bootstrap_mode == "off":
        logger.info("Bootstrap desativado por config local.")
        return False
    if has_bootstrap_checkpoint(source_table, sync_start_date):
        logger.info(
            "Bootstrap auto nao necessario: checkpoint encontrado para tabela=%s e sync_start_date=%s.",
            source_table,
            sync_start_date,
        )
        return False
    logger.info(
        "Bootstrap auto ativado: nenhum checkpoint para tabela=%s e sync_start_date=%s.",
        source_table,
        sync_start_date,
    )
    return True


def _infer_sap_status_aux_format(path: str, configured_format: str) -> str:
    if configured_format != "auto":
        return configured_format
    lowered = path.lower()
    if lowered.endswith(".xlsx") or lowered.endswith(".xlsm"):
        return "xlsx"
    return "csv"


def _to_local_dbfs_path(path: str) -> str:
    lowered = path.lower()
    if lowered.startswith("dbfs:/"):
        suffix = path[6:].lstrip("/")
        return f"/dbfs/{suffix}"
    return path


def _normalize_column_name(value: str) -> str:
    return _normalize_text_token(value)


def _resolve_source_column(
    available_columns: list[str],
    override: str | None,
    candidates: list[str],
    label: str,
    required: bool = True,
) -> str | None:
    normalized_map: dict[str, str] = {}
    for column in available_columns:
        normalized_map.setdefault(_normalize_column_name(column), column)

    if override:
        override_key = _normalize_column_name(override)
        resolved = normalized_map.get(override_key)
        if resolved:
            return resolved
        raise ValueError(
            f"Coluna override de {label} nao encontrada: {override}. Disponiveis: {available_columns}"
        )

    for candidate in candidates:
        resolved = normalized_map.get(_normalize_column_name(candidate))
        if resolved:
            return resolved

    if required:
        raise ValueError(
            f"Nenhuma coluna de {label} encontrada. Candidatas={candidates} disponiveis={available_columns}"
        )
    return None


def _normalize_sap_status_aux_raw(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    return _normalize_text_token(text)


def _to_sap_status_aux_canonico(status_raw) -> str:
    normalized = _normalize_sap_status_aux_raw(status_raw)
    if not normalized:
        return "INDEFINIDA"
    mapped = SAP_STATUS_AUX_EXACT_STATUS_MAP.get(normalized)
    if mapped:
        return mapped
    if "ORDA" in normalized:
        return "VIROU_ORDEM"
    if any(hint in normalized for hint in SAP_STATUS_AUX_CANCEL_CODE_HINTS):
        return "CANCELADA"
    if any(keyword in normalized for keyword in SAP_STATUS_AUX_CANCEL_KEYWORDS):
        return "CANCELADA"
    if any(keyword in normalized for keyword in SAP_STATUS_AUX_OPEN_KEYWORDS):
        return "ABERTA"
    return "INDEFINIDA"


def _read_sap_status_aux_rows(
    spark: SparkSession,
    path: str,
    file_format: str,
    csv_delimiter: str,
    xlsx_sheet: str | None,
) -> list[dict]:
    if file_format == "csv":
        df = (
            spark.read
            .option("header", "true")
            .option("inferSchema", "false")
            .option("sep", csv_delimiter)
            .csv(path)
        )
        return [row.asDict() for row in df.collect()]

    local_path = _to_local_dbfs_path(path)
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError(
            "pandas/openpyxl não estão instalados no cluster. "
            "Instale as bibliotecas no ambiente Databricks antes de executar o job."
        ) from exc

    sheet = xlsx_sheet if xlsx_sheet else 0
    frame = pd.read_excel(local_path, sheet_name=sheet, dtype=str)
    if hasattr(frame, "where"):
        frame = frame.where(frame.notna(), None)
    return frame.to_dict(orient="records")


def read_sap_status_aux_source(
    spark: SparkSession,
    path: str,
    file_format: str,
    csv_delimiter: str,
    xlsx_sheet: str | None,
    nota_column_override: str | None,
    status_column_override: str | None,
    export_date_column_override: str | None,
) -> tuple[list[dict], dict]:
    rows = _read_sap_status_aux_rows(
        spark=spark,
        path=path,
        file_format=file_format,
        csv_delimiter=csv_delimiter,
        xlsx_sheet=xlsx_sheet,
    )

    metrics = {
        "status": "success",
        "path": path,
        "format": file_format,
        "rows_read": len(rows),
        "rows_valid": 0,
        "rows_missing_nota": 0,
        "rows_missing_status": 0,
        "rows_invalid_nota": 0,
        "rows_dedup_discarded": 0,
        "rows_conflicting_status": 0,
        "nota_column": None,
        "status_column": None,
        "export_date_column": None,
    }

    if not rows:
        return [], metrics

    available_columns = list((rows[0] or {}).keys())
    nota_column = _resolve_source_column(
        available_columns,
        nota_column_override,
        SAP_STATUS_AUX_NOTA_COLUMNS_CANDIDATES,
        "nota",
        True,
    )
    status_column = _resolve_source_column(
        available_columns,
        status_column_override,
        SAP_STATUS_AUX_STATUS_COLUMNS_CANDIDATES,
        "status",
        True,
    )
    export_date_column = _resolve_source_column(
        available_columns,
        export_date_column_override,
        SAP_STATUS_AUX_EXPORT_DATE_COLUMNS_CANDIDATES,
        "data_exportacao",
        False,
    )

    metrics["nota_column"] = nota_column
    metrics["status_column"] = status_column
    metrics["export_date_column"] = export_date_column

    best_by_nota: dict[str, dict] = {}
    for row in rows:
        row_dict = row or {}
        numero_original = _as_clean_text(row_dict.get(nota_column))
        if not numero_original:
            metrics["rows_missing_nota"] += 1
            continue

        numero_norm = _normalize_numero_nota(numero_original)
        if not numero_norm:
            metrics["rows_invalid_nota"] += 1
            continue

        status_raw = _as_clean_text(row_dict.get(status_column))
        if not status_raw:
            metrics["rows_missing_status"] += 1
            continue

        status_canonico = _to_sap_status_aux_canonico(status_raw)
        data_exportacao = _normalize_iso_date(row_dict.get(export_date_column)) if export_date_column else None
        candidate = {
            "numero_nota_norm": numero_norm,
            "numero_nota_original": numero_original,
            "status_raw": status_raw,
            "status_canonico": status_canonico,
            "data_exportacao": data_exportacao,
        }

        current = best_by_nota.get(numero_norm)
        if current is None:
            best_by_nota[numero_norm] = candidate
            continue

        metrics["rows_dedup_discarded"] += 1
        if current.get("status_canonico") != status_canonico:
            metrics["rows_conflicting_status"] += 1

        current_rank = SAP_STATUS_AUX_CANONICAL_PRIORITY.get(current.get("status_canonico") or "", 0)
        candidate_rank = SAP_STATUS_AUX_CANONICAL_PRIORITY.get(status_canonico, 0)
        if candidate_rank >= current_rank:
            best_by_nota[numero_norm] = candidate

    records = list(best_by_nota.values())
    metrics["rows_valid"] = len(records)
    return records, metrics


def get_latest_sap_status_aux_imported_at() -> str | None:
    result = (
        supabase.table("notas_status_sap_aux")
        .select("importado_em")
        .order("importado_em", desc=True)
        .limit(1)
        .execute()
    )
    if result.data and result.data[0].get("importado_em"):
        return result.data[0]["importado_em"]
    return None


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = _normalize_iso_datetime(value)
    if not normalized:
        return None
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def upsert_sap_status_aux_records(records: list[dict], sync_id: str, path: str, lote_id: str) -> tuple[int, int]:
    if not records:
        return 0, 0

    imported_at = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "numero_nota_norm": record["numero_nota_norm"],
            "numero_nota_original": record["numero_nota_original"],
            "status_raw": record["status_raw"],
            "status_canonico": record["status_canonico"],
            "data_exportacao": record.get("data_exportacao"),
            "arquivo_origem": path,
            "lote_id": lote_id,
            "sync_id": sync_id,
            "importado_em": imported_at,
        }
        for record in records
    ]

    inserted = 0
    updated = 0
    for i in range(0, len(payload), SAP_STATUS_AUX_BATCH_SIZE):
        batch = payload[i:i + SAP_STATUS_AUX_BATCH_SIZE]
        result = supabase.rpc("importar_notas_status_sap_aux", {"p_records": batch}).execute()
        row = (result.data or [{}])[0]
        inserted += int(row.get("inseridas") or 0)
        updated += int(row.get("atualizadas") or 0)

    return inserted, updated


def run_sap_status_aux_sync(spark: SparkSession, sync_id: str) -> dict:
    metrics = {
        "status": "not_configured",
        "enabled": FAST_RUN_SAP_STATUS_AUX,
        "required": FAST_SAP_STATUS_AUX_REQUIRED,
        "path": FAST_SAP_STATUS_AUX_PATH,
        "format": None,
        "refresh_minutes": FAST_SAP_STATUS_AUX_REFRESH_MINUTES,
        "csv_delimiter": FAST_SAP_STATUS_AUX_CSV_DELIMITER,
        "xlsx_sheet": FAST_SAP_STATUS_AUX_XLSX_SHEET,
        "rows_read": 0,
        "rows_valid": 0,
        "rows_missing_nota": 0,
        "rows_missing_status": 0,
        "rows_invalid_nota": 0,
        "rows_dedup_discarded": 0,
        "rows_conflicting_status": 0,
        "nota_column": None,
        "status_column": None,
        "export_date_column": None,
        "inseridas": 0,
        "atualizadas": 0,
        "lote_id": None,
        "last_imported_at": None,
        "minutes_since_last_import": None,
        "error": None,
    }

    if not FAST_RUN_SAP_STATUS_AUX:
        metrics["status"] = "disabled"
        if FAST_SAP_STATUS_AUX_REQUIRED:
            metrics["error"] = "Status SAP auxiliar marcado como obrigatorio, mas esta desabilitado."
            raise ValueError(metrics["error"])
        return metrics

    if not FAST_SAP_STATUS_AUX_PATH:
        metrics["status"] = "missing_path"
        metrics["error"] = "FAST_SAP_STATUS_AUX_PATH nao configurado."
        if FAST_SAP_STATUS_AUX_REQUIRED:
            raise ValueError(metrics["error"])
        return metrics

    resolved_format = _infer_sap_status_aux_format(FAST_SAP_STATUS_AUX_PATH, FAST_SAP_STATUS_AUX_FORMAT)
    metrics["format"] = resolved_format

    latest_imported_at = get_latest_sap_status_aux_imported_at()
    metrics["last_imported_at"] = latest_imported_at
    if FAST_SAP_STATUS_AUX_REFRESH_MINUTES > 0 and latest_imported_at:
        last_import_dt = _parse_iso_datetime(latest_imported_at)
        if last_import_dt:
            delta_minutes = int((datetime.now(timezone.utc) - last_import_dt).total_seconds() // 60)
            metrics["minutes_since_last_import"] = max(delta_minutes, 0)
            if delta_minutes < FAST_SAP_STATUS_AUX_REFRESH_MINUTES:
                metrics["status"] = "skipped_recent"
                return metrics

    records, read_metrics = read_sap_status_aux_source(
        spark=spark,
        path=FAST_SAP_STATUS_AUX_PATH,
        file_format=resolved_format,
        csv_delimiter=FAST_SAP_STATUS_AUX_CSV_DELIMITER,
        xlsx_sheet=FAST_SAP_STATUS_AUX_XLSX_SHEET,
        nota_column_override=FAST_SAP_STATUS_AUX_NOTA_COLUMN,
        status_column_override=FAST_SAP_STATUS_AUX_STATUS_COLUMN,
        export_date_column_override=FAST_SAP_STATUS_AUX_EXPORT_DATE_COLUMN,
    )
    metrics.update(read_metrics)

    if FAST_SAP_STATUS_AUX_REQUIRED and metrics["rows_valid"] <= 0:
        metrics["status"] = "empty_required"
        metrics["error"] = "Carga auxiliar SAP obrigatoria retornou zero linhas validas."
        raise ValueError(metrics["error"])
    if metrics["rows_valid"] <= 0:
        metrics["status"] = "empty_source"
        return metrics

    lote_id = str(uuid4())
    metrics["lote_id"] = lote_id
    inserted, updated = upsert_sap_status_aux_records(records, sync_id, FAST_SAP_STATUS_AUX_PATH, lote_id)
    metrics["inseridas"] = inserted
    metrics["atualizadas"] = updated
    metrics["status"] = "success"
    return metrics


def read_new_notes(
    spark: SparkSession,
    source_table: str,
    window_days: int,
    force_window: bool,
    ignore_watermark: bool,
    sync_start_date: str,
    full_bootstrap: bool,
) -> tuple[list[dict], dict]:
    watermark = get_watermark()
    logger.info(
        "Parametros leitura -> watermark_bruto=%s, sync_start_date=%s, force_window=%s, ignore_watermark=%s, full_bootstrap=%s, window_days=%s",
        watermark,
        sync_start_date,
        force_window,
        ignore_watermark,
        full_bootstrap,
        window_days,
    )

    source_recency_expr = _build_notes_source_recency_date_expr(spark, source_table)
    source_metrics = _summarize_note_source_columns(spark, source_table)
    source_range_metrics = _collect_notes_source_range_metrics(spark, source_table, source_recency_expr)

    if full_bootstrap:
        df = spark.sql(f"""
            SELECT *
            FROM (
                SELECT *, {source_recency_expr} AS SOURCE_RECENCY_NORM
                FROM {source_table}
            ) t
            WHERE SOURCE_RECENCY_NORM >= date('{sync_start_date}')
            ORDER BY SOURCE_RECENCY_NORM ASC, NUMERO_NOTA ASC
        """)
        effective_start = sync_start_date
    elif force_window:
        window_start_date = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
        effective_start = max(window_start_date, sync_start_date)
    elif ignore_watermark:
        effective_start = sync_start_date
    else:
        watermark_date = _normalize_iso_date(watermark)
        if watermark_date and _watermark_is_too_future(watermark_date):
            watermark_date = None
        effective_start = max(watermark_date, sync_start_date) if watermark_date else sync_start_date

    if not full_bootstrap:
        df = spark.sql(f"""
            SELECT *
            FROM (
                SELECT *, {source_recency_expr} AS SOURCE_RECENCY_NORM
                FROM {source_table}
            ) t
            WHERE SOURCE_RECENCY_NORM >= date('{effective_start}')
            ORDER BY SOURCE_RECENCY_NORM ASC, NUMERO_NOTA ASC
        """)

    rows = df.collect()
    if not rows:
        _log_empty_result_diagnostics(
            spark,
            source_table,
            effective_start or sync_start_date,
            source_recency_expr,
        )

    notes: list[dict] = []
    missing_centro = 0
    skipped_sem_numero = 0
    notes_with_ordem_sap = 0
    notes_with_data_conclusao = 0
    notes_with_data_atualizacao = 0
    notes_with_status_obj_admin = 0
    notes_with_modificador_responsavel = 0
    notes_with_solicitante = 0
    notes_with_streaming_timestamp = 0
    distinct_centros: set[str] = set()

    for row in rows:
        row_dict = row.asDict()
        numero = _as_clean_text(row_dict.get("NUMERO_NOTA"))
        if not numero:
            skipped_sem_numero += 1
            continue

        centro = _extract_centro_from_candidates(row_dict, NOTA_CENTRO_COLUMNS_CANDIDATES)
        if not centro:
            missing_centro += 1
        else:
            distinct_centros.add(centro)

        ordem_sap = _as_clean_text(row_dict.get("ORDEM"))
        if ordem_sap:
            notes_with_ordem_sap += 1

        if _normalize_iso_date(row_dict.get("DATA_CONCLUSAO")):
            notes_with_data_conclusao += 1
        if _normalize_iso_datetime(row_dict.get("DATA_ATUALIZACAO")):
            notes_with_data_atualizacao += 1
        status_sap = _as_clean_text(row_dict.get("STATUS_OBJ_ADMIN"))
        if status_sap:
            notes_with_status_obj_admin += 1
        if _as_clean_text(row_dict.get("MODIFICADOR_RESPONSAVEL")):
            notes_with_modificador_responsavel += 1
        if _as_clean_text(row_dict.get("SOLICITANTE")):
            notes_with_solicitante += 1

        streaming_timestamp = _extract_note_source_timestamp(row_dict)
        if streaming_timestamp:
            notes_with_streaming_timestamp += 1

        notes.append(
            {
                "numero_nota": numero,
                "tipo_nota": row_dict.get("TIPO_NOTA"),
                "descricao": row_dict.get("TEXTO_BREVE") or "Sem descricao",
                "descricao_objeto": row_dict.get("TEXTO_DESC_OBJETO"),
                "prioridade": row_dict.get("PRIORIDADE"),
                "tipo_prioridade": row_dict.get("TIPO_PRIORIDADE"),
                "criado_por_sap": row_dict.get("CRIADO_POR"),
                "solicitante": row_dict.get("SOLICITANTE"),
                "data_criacao_sap": str(row_dict["DATA_CRIACAO"]) if row_dict.get("DATA_CRIACAO") else None,
                "data_nota": str(row_dict["DATA_NOTA"]) if row_dict.get("DATA_NOTA") else None,
                "hora_nota": row_dict.get("HORA_NOTA"),
                "ordem_sap": ordem_sap,
                "centro": centro,
                "status_sap": status_sap,
                "conta_fornecedor": row_dict.get("N_CONTA_FORNECEDOR"),
                "autor_nota": row_dict.get("AUTOR_NOTA_QM_PM"),
                "streaming_timestamp": streaming_timestamp,
                "raw_data": _to_json_serializable(row_dict),
            }
        )

    batch_metrics = {
        **source_metrics,
        **source_range_metrics,
        "source_rows_read": len(rows),
        "source_notes_valid": len(notes),
        "source_notes_skipped_missing_numero": skipped_sem_numero,
        "source_notes_missing_centro": missing_centro,
        "source_notes_with_ordem_sap": notes_with_ordem_sap,
        "source_notes_without_ordem_sap": max(len(notes) - notes_with_ordem_sap, 0),
        "source_notes_with_data_conclusao": notes_with_data_conclusao,
        "source_notes_with_data_atualizacao": notes_with_data_atualizacao,
        "source_notes_with_status_obj_admin": notes_with_status_obj_admin,
        "source_notes_with_modificador_responsavel": notes_with_modificador_responsavel,
        "source_notes_with_solicitante": notes_with_solicitante,
        "source_notes_with_streaming_timestamp": notes_with_streaming_timestamp,
        "source_distinct_centros": len(distinct_centros),
        "source_effective_start": effective_start,
        "source_watermark_raw": watermark,
        "source_recency_expr": source_recency_expr,
        "source_data_criacao_expr": source_recency_expr,
        "source_raw_data_payload_mode": "object",
        "source_raw_data_payload_object_count": len(notes),
    }
    _raise_if_source_result_is_inconsistent(batch_metrics)
    return notes, batch_metrics


def upsert_notes(notes: list[dict], sync_id: str) -> tuple[int, int]:
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

    existing_numbers = set()
    numero_notas = [n["numero_nota"] for n in deduped_notes]
    for i in range(0, len(numero_notas), BATCH_SIZE):
        batch = numero_notas[i:i + BATCH_SIZE]
        result = supabase.table("notas_manutencao").select("numero_nota").in_("numero_nota", batch).execute()
        existing_numbers.update(r["numero_nota"] for r in (result.data or []))

    sap_fields = [
        "tipo_nota",
        "descricao",
        "descricao_objeto",
        "prioridade",
        "tipo_prioridade",
        "criado_por_sap",
        "solicitante",
        "data_criacao_sap",
        "data_nota",
        "hora_nota",
        "ordem_sap",
        "centro",
        "status_sap",
        "conta_fornecedor",
        "autor_nota",
        "streaming_timestamp",
        "raw_data",
        "sync_id",
    ]
    upsert_payload = [
        {
            "numero_nota": note["numero_nota"],
            **{k: note[k] for k in sap_fields if k in note},
        }
        for note in deduped_notes
    ]

    for i in range(0, len(upsert_payload), 500):
        batch = upsert_payload[i:i + 500]
        supabase.table("notas_manutencao").upsert(batch, on_conflict="numero_nota").execute()

    inserted_count = sum(1 for note in deduped_notes if note["numero_nota"] not in existing_numbers)
    updated_count = len(deduped_notes) - inserted_count
    return inserted_count, updated_count


def run_register_orders(sync_id: str) -> tuple[int, int]:
    result = supabase.rpc("registrar_ordens_por_notas", {"p_sync_id": sync_id}).execute()
    row = (result.data or [{}])[0]
    return int(row.get("ordens_detectadas") or 0), int(row.get("notas_auto_concluidas") or 0)


def reconcile_copy_intent_states(sync_id: str, ttl_minutes: int, confirm_repair_minutes: int) -> dict:
    result = supabase.rpc(
        "reconciliar_notas_em_geracao",
        {
            "p_sync_id": sync_id,
            "p_ttl_minutes": ttl_minutes,
            "p_confirm_repair_minutes": confirm_repair_minutes,
        },
    ).execute()
    raw = result.data
    if isinstance(raw, list):
        raw = raw[0] if raw else {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "em_geracao_to_alerta": int(raw.get("em_geracao_to_alerta") or 0),
        "confirmadas": int(raw.get("confirmadas") or 0),
        "confirm_repaired": int(raw.get("confirm_repaired") or 0),
        "ttl_minutes": int(raw.get("ttl_minutes") or ttl_minutes),
        "confirm_repair_minutes": int(raw.get("confirm_repair_minutes") or confirm_repair_minutes),
    }


def run_distribution(sync_id: str) -> int:
    result = supabase.rpc("distribuir_notas", {"p_sync_id": sync_id}).execute()
    return len(result.data) if result.data else 0


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


def main() -> None:
    spark = SparkSession.builder.getOrCreate()
    _ensure_runtime_dependency("supabase")
    from supabase import create_client
    global supabase
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    notes_source_table = _resolve_notes_source_table(spark)
    current_step = "startup"
    read_count = 0
    inserted = 0
    updated = 0
    distributed = 0
    full_bootstrap = False

    note_batch_metrics: dict[str, object] = {}
    sap_status_aux_metrics: dict[str, object] = {
        "status": "not_run",
        "error": None,
        "required": FAST_SAP_STATUS_AUX_REQUIRED,
    }
    copy_reconcile_status = "not_run"
    copy_reconcile_error: str | None = None
    copy_reconcile_metrics = {
        "em_geracao_to_alerta": 0,
        "confirmadas": 0,
        "confirm_repaired": 0,
        "ttl_minutes": FAST_COPY_INTENT_TTL_MINUTES,
        "confirm_repair_minutes": FAST_COPY_INTENT_CONFIRM_REPAIR_MINUTES,
    }
    ordens_detectadas = 0
    notas_auto_concluidas = 0
    cockpit_sync_metrics: dict[str, object] = {
        "status": "not_run",
        "inseridas": 0,
        "atualizadas": 0,
        "total_elegiveis": 0,
        "error": None,
    }

    _ensure_supabase_healthcheck()
    sync_id = create_sync_log(spark, metadata={"job": JOB_NAME, "streaming_table": notes_source_table})

    try:
        full_bootstrap = should_run_full_bootstrap(FAST_BOOTSTRAP_MODE, notes_source_table, FAST_SYNC_START_DATE)

        current_step = "read_new_notes"
        notes, note_batch_metrics = read_new_notes(
            spark,
            source_table=notes_source_table,
            window_days=FAST_WINDOW_DAYS,
            force_window=FAST_FORCE_WINDOW,
            ignore_watermark=FAST_IGNORE_WATERMARK,
            sync_start_date=FAST_SYNC_START_DATE,
            full_bootstrap=full_bootstrap,
        )
        read_count = len(notes)

        current_step = "upsert_notes"
        inserted, updated = upsert_notes(notes, sync_id)

        if FAST_RUN_SAP_STATUS_AUX:
            try:
                current_step = "run_sap_status_aux_sync"
                sap_status_aux_metrics = run_sap_status_aux_sync(spark, sync_id)
            except Exception as exc:
                sap_status_aux_metrics = {
                    "status": "error_required" if FAST_SAP_STATUS_AUX_REQUIRED else "error_tolerated",
                    "error": f"{type(exc).__name__}: {exc}",
                    "required": FAST_SAP_STATUS_AUX_REQUIRED,
                }
                if FAST_SAP_STATUS_AUX_REQUIRED:
                    raise

        current_step = "run_register_orders"
        ordens_detectadas, notas_auto_concluidas = run_register_orders(sync_id)

        try:
            current_step = "reconcile_copy_intent_states"
            copy_reconcile_metrics = reconcile_copy_intent_states(
                sync_id,
                FAST_COPY_INTENT_TTL_MINUTES,
                FAST_COPY_INTENT_CONFIRM_REPAIR_MINUTES,
            )
            copy_reconcile_status = "success"
            copy_reconcile_error = None
        except Exception as exc:
            copy_reconcile_status = "error_tolerated"
            copy_reconcile_error = f"{type(exc).__name__}: {exc}"

        current_step = "run_distribution"
        distributed = run_distribution(sync_id)

        if FAST_RUN_COCKPIT_SYNC:
            current_step = "run_cockpit_convergencia_sync"
            cockpit_sync_metrics = run_cockpit_convergencia_sync(sync_id)

        finalize_sync_log(
            sync_id,
            read_count=read_count,
            inserted=inserted,
            updated=updated,
            distributed=distributed,
            metadata={
                "job": JOB_NAME,
                "current_step": current_step,
                "window_days": FAST_WINDOW_DAYS,
                "force_window": FAST_FORCE_WINDOW,
                "ignore_watermark": FAST_IGNORE_WATERMARK,
                "sync_start_date": FAST_SYNC_START_DATE,
                "bootstrap_mode": FAST_BOOTSTRAP_MODE,
                "full_bootstrap": full_bootstrap,
                "streaming_table": notes_source_table,
                "source_primary_table": PRIMARY_NOTES_SOURCE_TABLE,
                "source_fallback_used": notes_source_table != PRIMARY_NOTES_SOURCE_TABLE,
                **note_batch_metrics,
                "sap_status_aux_status": sap_status_aux_metrics.get("status"),
                "sap_status_aux_error": sap_status_aux_metrics.get("error"),
                "copy_reconcile_status": copy_reconcile_status,
                "copy_reconcile_error": copy_reconcile_error,
                "copy_ttl_minutes": copy_reconcile_metrics["ttl_minutes"],
                "copy_confirm_repair_minutes": copy_reconcile_metrics["confirm_repair_minutes"],
                "copy_em_geracao_to_alerta": copy_reconcile_metrics["em_geracao_to_alerta"],
                "copy_confirmadas": copy_reconcile_metrics["confirmadas"],
                "copy_confirm_repaired": copy_reconcile_metrics["confirm_repaired"],
                "ordens_detectadas": ordens_detectadas,
                "notas_auto_concluidas": notas_auto_concluidas,
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
            read_count=read_count,
            inserted=inserted,
            updated=updated,
            distributed=distributed,
            metadata={
                "job": JOB_NAME,
                "current_step": current_step,
                "window_days": FAST_WINDOW_DAYS,
                "force_window": FAST_FORCE_WINDOW,
                "ignore_watermark": FAST_IGNORE_WATERMARK,
                "sync_start_date": FAST_SYNC_START_DATE,
                "bootstrap_mode": FAST_BOOTSTRAP_MODE,
                "full_bootstrap": full_bootstrap,
                "streaming_table": notes_source_table,
                "source_primary_table": PRIMARY_NOTES_SOURCE_TABLE,
                "source_fallback_used": notes_source_table != PRIMARY_NOTES_SOURCE_TABLE,
                **note_batch_metrics,
                "sap_status_aux_status": sap_status_aux_metrics.get("status"),
                "sap_status_aux_error": sap_status_aux_metrics.get("error"),
                "copy_reconcile_status": copy_reconcile_status,
                "copy_reconcile_error": copy_reconcile_error,
                "ordens_detectadas": ordens_detectadas,
                "notas_auto_concluidas": notas_auto_concluidas,
                "cockpit_sync_status": cockpit_sync_metrics.get("status"),
                "cockpit_sync_error": cockpit_sync_metrics.get("error"),
            },
            error=str(exc),
        )
        raise


if __name__ == "__main__":
    main()
