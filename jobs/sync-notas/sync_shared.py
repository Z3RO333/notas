"""
Utilitários compartilhados para os jobs de sync de notas.
Importado por sync_job_fast.py, sync_job_medium.py e sync_job_heavy.py.
"""

import subprocess
subprocess.check_call(["pip", "install", "supabase"])

import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from pyspark.sql import SparkSession
from supabase import Client, create_client

# ----- Configuracao -----
SUPABASE_URL = dbutils.secrets.get(scope="cockpit", key="SUPABASE_URL")
SUPABASE_SERVICE_KEY = dbutils.secrets.get(scope="cockpit", key="SUPABASE_SERVICE_ROLE_KEY")
STREAMING_TABLE = "manutencao.streaming.notas_qm"
STREAMING_TABLE_QMEL = "manutencao.streaming.notas_qmel"
PMPL_TABLE = "manutencao.gold.pmpl_pmos"
ORDERS_DOCUMENT_SOURCE_TABLE = "manutencao.silver.mestre_dados_ordem"
ORDERS_MAINTENANCE_SOURCE_TABLE = "manutencao.silver.selecao_ordens_manutencao"

VALID_WINDOWS = {30, 90, 180, 365}
DEFAULT_WINDOW_DAYS = 30
DEFAULT_SYNC_START_DATE = "2026-01-01"
MAX_WATERMARK_FUTURE_DAYS = 1
VALID_BOOTSTRAP_MODES = {"auto", "force", "off"}
DEFAULT_BOOTSTRAP_MODE = "auto"
BOOTSTRAP_CHECKPOINT_SCAN_LIMIT = 500
BATCH_SIZE = 100
PMPL_FETCH_BATCH_SIZE = 300
PMPL_RPC_BATCH_SIZE = 200
PMPL_MIN_AGE_DAYS = 0
ORDERS_DOCUMENT_UPSERT_BATCH_SIZE = 500
ORDERS_MAINTENANCE_UPSERT_BATCH_SIZE = 500
PMPL_STANDALONE_WINDOW_DAYS = 90
PMPL_STANDALONE_BATCH_SIZE = 500
PMPL_STANDALONE_TIPO_ORDENS = ("PMPL", "PMOS")
PMPL_STANDALONE_LOOKBACK_DAYS = 2
ORDERS_REF_V2_TOLERATED_FAILURES = 3
ORDERS_REF_V2_RUNTIME_JOB_NAME = "sync_notas_to_supabase"
ORDERS_REF_V2_RUNTIME_STATE_TABLE = "sync_job_runtime_state"
ORDERS_REF_V2_LOOKBACK_DAYS = 2
COCKPIT_CONVERGENCE_TABLE = "notas_convergencia_cockpit"
COCKPIT_CONVERGENCE_UPSERT_BATCH_SIZE = 500
COCKPIT_CONVERGENCE_FETCH_PAGE_SIZE = 1000
COCKPIT_CONVERGENCE_SPARK_LOOKUP_BATCH_SIZE = 300
CONVERGENCE_INCREMENTAL_DAYS = 7

OPEN_STATUS = {"aberta", "em_tratativa", "desconhecido"}
NOTA_OPEN_STATUS = {"nova", "em_andamento", "encaminhada_fornecedor"}
COCKPIT_CONVERGENCE_GRACE_HOURS = 48
COCKPIT_ESTADO_OPERACIONAL_VALUES = (
    "COCKPIT_PENDENTE",
    "AGUARDANDO_CONVERGENCIA",
    "COM_ORDEM",
    "ENCERRADA_SEM_ORDEM",
    "CANCELADA",
)
SAP_FINAL_STATUS_KEYWORDS = (
    "ENCERR",
    "CONCL",
    "FINALIZ",
    "FECH",
    "CANCEL",
    "AGUARDANDO_FATURAMENTO_NF",
    "EXECUCAO_SATISFATORIO",
    "EXECUCAO_SATISFATORIA",
)

STATUS_PRIORITY = {
    "CANCELADO": 5,
    "CONCLUIDO": 4,
    "AGUARDANDO_FATURAMENTO_NF": 4,
    "EXECUCAO_SATISFATORIO": 4,
    "EXECUCAO_SATISFATORIA": 4,
    "EM_PROCESSAMENTO": 3,
    "EM_EXECUCAO": 3,
    "AVALIACAO_DA_EXECUCAO": 3,
    "AVALIACAO_DE_EXECUCAO": 3,
    "EQUIPAMENTO_EM_CONSERTO": 3,
    "EXECUCAO_NAO_REALIZADA": 3,
    "ENVIAR_EMAIL_PFORNECEDOR": 3,
    "ABERTO": 2,
}

STATUS_COLUMNS_CANDIDATES = [
    "STATUS",
    "STATUS_ORDEM",
    "STATUS_OBJ_ADMIN",
    "STATUS_TRIM",
]

NOTA_CENTRO_COLUMNS_CANDIDATES = [
    "CENTRO_MATERIAL",
    "CENTRO_LOCALIZACAO",
    "CENTRO",
]

PMPL_CENTRO_COLUMN = "CENTRO_LOCALIZACAO"
PMPL_TIPO_ORDEM_COLUMN = "TIPO_ORDEM"
ORDERS_DOCUMENT_ORDER_COLUMN = "ORDEM"
ORDERS_DOCUMENT_TYPE_COLUMN = "TIPO_DOCUMENTO_VENDAS"
ORDERS_MAINTENANCE_ORDER_COLUMN = "ORDEM"
ORDERS_MAINTENANCE_NOTE_COLUMN = "NOTA"
ORDERS_MAINTENANCE_TYPE_COLUMN = "TIPO_ORDEM"
ORDERS_MAINTENANCE_TEXT_COLUMN = "TEXTO_BREVE"
ORDERS_MAINTENANCE_CENTER_COLUMN = "CENTRO_LIBERACAO"
ORDERS_MAINTENANCE_EXTRACTION_COLUMN = "DATA_EXTRACAO"
PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES = [
    "DATA_ENTRADA",
    "DATA_CRIACAO",
    "DATA_ABERTURA",
    "DT_CRIACAO",
    "DT_ENTRADA",
]

NOTA_TIMESTAMP_COLUMNS_CANDIDATES = [
    # Fonte oficial (está populada conforme validado)
    "HORA_NOTA",
    # Fallbacks fortes
    "__TIMESTAMP",
    "DATA_ATUALIZACAO",
    "DATA_CRIACAO",
    "DATA_NOTA",
]

# service_role bypassa RLS - intencional para job de sistema
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_notas")


# ----- Normalização -----

def _as_clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


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


def _to_utc_iso_datetime(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    return _normalize_iso_datetime(value)


def _to_utc_date_str(value) -> str | None:
    iso_dt = _to_utc_iso_datetime(value)
    if iso_dt:
        return iso_dt[:10]
    return _normalize_iso_date(value)


# ----- Detecção de fechamento SAP -----

def _has_source_closure_without_order(row_dict: dict) -> bool:
    ordem = _as_clean_text(row_dict.get("ORDEM"))
    if ordem:
        return False
    data_encerramento = _normalize_iso_date(row_dict.get("DATA_ENC_NOTA"))
    if data_encerramento:
        return True
    data_conclusao = _normalize_iso_date(row_dict.get("DATA_CONCLUSAO"))
    if not data_conclusao:
        return False
    try:
        return date.fromisoformat(data_conclusao) <= datetime.now(timezone.utc).date()
    except ValueError:
        return False


def _has_future_source_closure_without_order(row_dict: dict) -> bool:
    ordem = _as_clean_text(row_dict.get("ORDEM"))
    if ordem:
        return False
    data_conclusao = _normalize_iso_date(row_dict.get("DATA_CONCLUSAO"))
    if not data_conclusao:
        return False
    try:
        return date.fromisoformat(data_conclusao) > datetime.now(timezone.utc).date()
    except ValueError:
        return False


def _extract_raw_data_field(raw_data: dict | str | None, key: str) -> str | None:
    if raw_data is None:
        return None
    if isinstance(raw_data, dict):
        return _as_clean_text(raw_data.get(key))
    text = _as_clean_text(raw_data)
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    if isinstance(parsed, dict):
        return _as_clean_text(parsed.get(key))
    return None


def _normalize_status_sap_token(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    normalized = re.sub(r"\s+", "_", text.upper())
    return re.sub(r"_+", "_", normalized)


def _is_final_status_sap(value) -> bool:
    token = _normalize_status_sap_token(value)
    if not token:
        return False
    return any(keyword in token for keyword in SAP_FINAL_STATUS_KEYWORDS)


def _is_open_note_status(status_nota: str | None) -> bool:
    text = _as_clean_text(status_nota)
    if not text:
        return False
    return text.lower() in NOTA_OPEN_STATUS


def _resolve_hora_base_utc(*candidates) -> str | None:
    for value in candidates:
        normalized = _to_utc_iso_datetime(value)
        if normalized:
            return normalized
    return None


def _has_sap_structural_closure(
    *,
    status_sap: str | None,
    data_conclusao: str | None,
    data_enc_nota: str | None,
    now_utc: datetime | None = None,
) -> bool:
    if _normalize_iso_date(data_enc_nota):
        return True

    data_conclusao_date = _to_utc_date_str(data_conclusao)
    if data_conclusao_date:
        reference_date = (now_utc or datetime.now(timezone.utc)).date()
        try:
            if date.fromisoformat(data_conclusao_date) <= reference_date:
                return True
        except ValueError:
            pass

    return _is_final_status_sap(status_sap)


def _classify_cockpit_estado_operacional(
    *,
    tem_ordem_vinculada: bool,
    status_nota: str | None,
    status_sap: str | None,
    data_conclusao: str | None,
    data_enc_nota: str | None,
    hora_base_utc: str | None,
    convergence_grace_hours: int = COCKPIT_CONVERGENCE_GRACE_HOURS,
    now_utc: datetime | None = None,
) -> str:
    if tem_ordem_vinculada:
        return "COM_ORDEM"

    if _has_sap_structural_closure(
        status_sap=status_sap,
        data_conclusao=data_conclusao,
        data_enc_nota=data_enc_nota,
        now_utc=now_utc,
    ):
        return "ENCERRADA_SEM_ORDEM"

    status_norm = (_as_clean_text(status_nota) or "").lower()
    if status_norm == "cancelada":
        return "CANCELADA"
    if status_norm == "concluida":
        return "ENCERRADA_SEM_ORDEM"

    if not _is_open_note_status(status_norm):
        return "AGUARDANDO_CONVERGENCIA"

    now_ts = now_utc or datetime.now(timezone.utc)
    hora_base_norm = _to_utc_iso_datetime(hora_base_utc)
    if not hora_base_norm:
        return "AGUARDANDO_CONVERGENCIA"

    try:
        base_ts = datetime.fromisoformat(hora_base_norm.replace("Z", "+00:00"))
    except ValueError:
        return "AGUARDANDO_CONVERGENCIA"

    if base_ts.tzinfo is None:
        base_ts = base_ts.replace(tzinfo=timezone.utc)
    else:
        base_ts = base_ts.astimezone(timezone.utc)

    age_hours = max((now_ts - base_ts).total_seconds() / 3600.0, 0.0)
    if age_hours > convergence_grace_hours:
        return "COCKPIT_PENDENTE"
    return "AGUARDANDO_CONVERGENCIA"


# ----- Classificação de erros -----

def _is_statement_timeout_error(error: Exception) -> bool:
    text = str(error).lower()
    return "statement timeout" in text and ("57014" in text or "canceling statement due to statement timeout" in text)


def _is_missing_rpc_error(exc: Exception, rpc_name: str) -> bool:
    text = str(exc).lower()
    return (
        "pgrst202" in text
        or "42883" in text
        or (rpc_name.lower() in text and ("not found" in text or "does not exist" in text))
    )


# ----- Completude de referência -----

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


def _watermark_is_too_future(iso_date: str, max_future_days: int = MAX_WATERMARK_FUTURE_DAYS) -> bool:
    candidate = date.fromisoformat(iso_date)
    max_allowed = datetime.now(timezone.utc).date() + timedelta(days=max_future_days)
    return candidate > max_allowed


# ----- Spark utilities -----

def _resolve_existing_columns(
    spark: SparkSession,
    table_name: str,
    candidates: list[str],
) -> list[str]:
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


# ----- Batches e SQL -----

def _iter_batches(items: list, batch_size: int):
    for i in range(0, len(items), batch_size):
        yield items[i:i + batch_size]


def _sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _fetch_all_table_rows(
    table_name: str,
    select_columns: str,
    order_column: str,
    page_size: int = COCKPIT_CONVERGENCE_FETCH_PAGE_SIZE,
) -> list[dict]:
    """Lê todas as linhas usando keyset pagination."""
    rows: list[dict] = []
    last_value = None
    page = 0

    while True:
        query = (
            supabase.table(table_name)
            .select(select_columns)
            .order(order_column, desc=False)
            .limit(page_size)
        )
        if last_value is not None:
            query = query.gt(order_column, last_value)

        result = query.execute()
        batch = result.data or []
        if not batch:
            break

        rows.extend(batch)
        page += 1
        if len(batch) < page_size:
            break

        next_last_value = batch[-1].get(order_column)
        if next_last_value is None:
            logger.warning(
                "Keyset interrompido em %s: última linha sem %s (page=%s, total=%s).",
                table_name, order_column, page, len(rows),
            )
            break

        if last_value == next_last_value:
            logger.warning(
                "Keyset interrompido em %s: valor de paginação não avançou (%s=%s, page=%s, total=%s).",
                table_name, order_column, next_last_value, page, len(rows),
            )
            break

        last_value = next_last_value

    return rows


# ----- Watermarks e config -----

def get_watermark() -> str | None:
    try:
        result_hora = (
            supabase.table("notas_manutencao")
            .select("hora_nota")
            .not_.is_("hora_nota", "null")
            .order("updated_at", desc=True)
            .limit(500)
            .execute()
        )
        max_hora_wm: str | None = None
        for row in (result_hora.data or []):
            hora_wm = _to_utc_iso_datetime(row.get("hora_nota"))
            if hora_wm and (max_hora_wm is None or hora_wm > max_hora_wm):
                max_hora_wm = hora_wm
        if max_hora_wm:
            return max_hora_wm
    except Exception as watermark_hora_error:
        logger.warning(
            "Falha ao buscar watermark por hora_nota. Usando fallback por data_criacao_sap. erro=%s",
            watermark_hora_error,
        )

    result_date = (
        supabase.table("notas_manutencao")
        .select("data_criacao_sap")
        .not_.is_("data_criacao_sap", "null")
        .order("data_criacao_sap", desc=True)
        .limit(1)
        .execute()
    )
    if result_date.data and result_date.data[0].get("data_criacao_sap"):
        date_wm = _normalize_iso_date(result_date.data[0]["data_criacao_sap"])
        if date_wm:
            return f"{date_wm}T00:00:00+00:00"
    return None


def get_pmpl_standalone_watermark() -> str | None:
    """Busca a data_entrada mais recente de ordens standalone existentes."""
    result = (
        supabase.table("ordens_notas_acompanhamento")
        .select("data_entrada")
        .is_("nota_id", "null")
        .not_.is_("data_entrada", "null")
        .order("data_entrada", desc=True)
        .limit(1)
        .execute()
    )
    if result.data and result.data[0].get("data_entrada"):
        return _normalize_iso_date(result.data[0]["data_entrada"])
    return None


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
        .eq("job_name", ORDERS_REF_V2_RUNTIME_JOB_NAME)
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
        "job_name": ORDERS_REF_V2_RUNTIME_JOB_NAME,
        "orders_ref_v2_failure_streak": max(int(streak), 0),
        "last_error": (error_message or "")[:2000] or None,
    }
    (
        supabase.table(ORDERS_REF_V2_RUNTIME_STATE_TABLE)
        .upsert(payload, on_conflict="job_name")
        .execute()
    )


def get_sync_window_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.window_days", str(DEFAULT_WINDOW_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning("Janela inválida em cockpit.sync.window_days=%s. Usando %s.", raw, DEFAULT_WINDOW_DAYS)
        return DEFAULT_WINDOW_DAYS
    if parsed not in VALID_WINDOWS:
        logger.warning("Janela %s não suportada. Usando %s.", parsed, DEFAULT_WINDOW_DAYS)
        return DEFAULT_WINDOW_DAYS
    return parsed


def should_force_window(spark: SparkSession) -> bool:
    raw = spark.conf.get("cockpit.sync.force_window", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def should_ignore_watermark(spark: SparkSession) -> bool:
    raw = spark.conf.get("cockpit.sync.ignore_watermark", "true")
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def get_sync_start_date(spark: SparkSession) -> str:
    raw = spark.conf.get("cockpit.sync.start_date", DEFAULT_SYNC_START_DATE)
    parsed = _normalize_iso_date(raw)
    if not parsed:
        logger.warning("Valor inválido em cockpit.sync.start_date=%s. Usando %s.", raw, DEFAULT_SYNC_START_DATE)
        return DEFAULT_SYNC_START_DATE
    return parsed


def get_pmpl_min_age_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.pm_refresh_min_age_days", str(PMPL_MIN_AGE_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning("Valor inválido em cockpit.sync.pm_refresh_min_age_days=%s. Usando %s.", raw, PMPL_MIN_AGE_DAYS)
        return PMPL_MIN_AGE_DAYS
    return max(parsed, 0)


def get_pmpl_standalone_window_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.pmpl_standalone_window_days", str(PMPL_STANDALONE_WINDOW_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning("Valor inválido em cockpit.sync.pmpl_standalone_window_days=%s. Usando %s.", raw, PMPL_STANDALONE_WINDOW_DAYS)
        return PMPL_STANDALONE_WINDOW_DAYS
    return max(parsed, 1)


def get_orders_ref_v2_lookback_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.orders_ref_v2_lookback_days", str(ORDERS_REF_V2_LOOKBACK_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning("Valor inválido em cockpit.sync.orders_ref_v2_lookback_days=%s. Usando %s.", raw, ORDERS_REF_V2_LOOKBACK_DAYS)
        return ORDERS_REF_V2_LOOKBACK_DAYS
    return max(parsed, 0)


def get_bootstrap_mode(spark: SparkSession) -> str:
    raw = _as_clean_text(spark.conf.get("cockpit.sync.bootstrap_mode", DEFAULT_BOOTSTRAP_MODE))
    mode = (raw or DEFAULT_BOOTSTRAP_MODE).lower()
    if mode not in VALID_BOOTSTRAP_MODES:
        logger.warning("Modo inválido em cockpit.sync.bootstrap_mode=%s. Usando %s.", raw, DEFAULT_BOOTSTRAP_MODE)
        return DEFAULT_BOOTSTRAP_MODE
    return mode


def has_bootstrap_checkpoint(sync_start_date: str) -> bool:
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
            and metadata.get("streaming_table") == STREAMING_TABLE
            and metadata.get("sync_start_date") == sync_start_date
        ):
            return True
    return False


def should_run_full_bootstrap(bootstrap_mode: str, sync_start_date: str) -> bool:
    if bootstrap_mode == "force":
        logger.info("Bootstrap forcado por cockpit.sync.bootstrap_mode=force.")
        return True
    if bootstrap_mode == "off":
        logger.info("Bootstrap desativado por cockpit.sync.bootstrap_mode=off.")
        return False
    if has_bootstrap_checkpoint(sync_start_date):
        logger.info(
            "Bootstrap auto não necessario: checkpoint encontrado para tabela=%s e sync_start_date=%s.",
            STREAMING_TABLE, sync_start_date,
        )
        return False
    logger.info(
        "Bootstrap auto ativado: nenhum checkpoint para tabela=%s e sync_start_date=%s.",
        STREAMING_TABLE, sync_start_date,
    )
    return True


# ----- Sync log -----

def create_sync_log(spark: SparkSession) -> str:
    sync_id = str(uuid4())
    job_id = spark.conf.get("spark.databricks.job.runId", "manual")
    supabase.table("sync_log").insert({
        "id": sync_id,
        "status": "running",
        "databricks_job_id": str(job_id),
    }).execute()
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
