"""
Databricks Job: Sync notas de manutencao do streaming para o Supabase.
Roda a cada 5 minutos via Databricks Jobs scheduler.

Fluxo:
  1. Le notas novas/atualizadas de qmel_clean
  2. Upsert no Supabase (tabela notas_manutencao)
  3. Registra ordens derivadas de notas (SAP + manual)
  4. Distribui apenas notas pendentes sem ordem
  5. Enriquecimento de status de ordens via PMPL (D0 por padrao)
  6. Registra resultado no sync_log
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
# Secrets armazenados no Databricks scope "cockpit"
SUPABASE_URL = dbutils.secrets.get(scope="cockpit", key="SUPABASE_URL")
SUPABASE_SERVICE_KEY = dbutils.secrets.get(scope="cockpit", key="SUPABASE_SERVICE_ROLE_KEY")
STREAMING_TABLE = "manutencao.streaming.qmel_clean"
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
PMPL_STANDALONE_WINDOW_DAYS = 90   # janela padrão para importar standalone (dias)
PMPL_STANDALONE_BATCH_SIZE = 500   # ordens por chamada de RPC
PMPL_STANDALONE_TIPO_ORDENS = ("PMPL", "PMOS")  # tipos importados standalone da pmpl_pmos
ORDERS_REF_V2_TOLERATED_FAILURES = 3
ORDERS_REF_V2_RUNTIME_JOB_NAME = "sync_notas_to_supabase"
ORDERS_REF_V2_RUNTIME_STATE_TABLE = "sync_job_runtime_state"

OPEN_STATUS = {"aberta", "em_tratativa", "desconhecido"}

STATUS_PRIORITY = {
    # Finais primeiro
    "CANCELADO": 5,
    "CONCLUIDO": 4,
    "AGUARDANDO_FATURAMENTO_NF": 4,
    "EXECUCAO_SATISFATORIO": 4,
    "EXECUCAO_SATISFATORIA": 4,   # variante feminina (depende da configuração SAP)
    # Em andamento
    "EM_PROCESSAMENTO": 3,
    "EM_EXECUCAO": 3,
    "AVALIACAO_DA_EXECUCAO": 3,
    "AVALIACAO_DE_EXECUCAO": 3,   # variante sem "DA"
    "EQUIPAMENTO_EM_CONSERTO": 3,
    "EXECUCAO_NAO_REALIZADA": 3,
    "ENVIAR_EMAIL_PFORNECEDOR": 3,
    # Inicial
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

# service_role bypassa RLS - intencional para job de sistema
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_notas")


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
    # Regra idêntica à ORDEM: remove zeros à esquerda quando numérico.
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


def _resolve_existing_columns(
    spark: SparkSession,
    table_name: str,
    candidates: list[str],
) -> list[str]:
    """Retorna colunas candidatas que existem na tabela (preservando ordem)."""
    existing_map = {col.upper(): col for col in spark.table(table_name).columns}
    resolved: list[str] = []
    for candidate in candidates:
        found = existing_map.get(candidate.upper())
        if found:
            resolved.append(found)
    return resolved


def _build_date_expr_from_columns(columns: list[str]) -> str:
    """Monta expressão Spark SQL robusta para normalizar data a partir de múltiplas colunas."""
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


def _build_data_criacao_date_expr(spark: SparkSession) -> str:
    # Suporta date/timestamp e formatos string comuns em múltiplas colunas candidatas.
    candidates = ["DATA_CRIACAO", "DATA_ENTRADA", "DATA_ABERTURA", "DT_CRIACAO", "DT_ENTRADA"]
    existing = _resolve_existing_columns(spark, STREAMING_TABLE, candidates)
    if not existing:
        logger.warning(
            "Nenhuma coluna de data candidata encontrada na tabela %s. Candidatas=%s",
            STREAMING_TABLE,
            candidates,
        )
    return _build_date_expr_from_columns(existing)


def _log_empty_result_diagnostics(spark: SparkSession, effective_start: str, data_criacao_expr: str):
    """Loga diagnosticos do source quando a leitura retorna zero linhas."""
    try:
        summary_row = spark.sql(f"""
            SELECT
              COUNT(*) AS total_rows,
              SUM(CASE WHEN {data_criacao_expr} IS NULL THEN 1 ELSE 0 END) AS data_criacao_invalidas,
              MIN({data_criacao_expr}) AS min_data_criacao,
              MAX({data_criacao_expr}) AS max_data_criacao
            FROM {STREAMING_TABLE}
        """).collect()[0]

        filtered_row = spark.sql(f"""
            SELECT COUNT(*) AS total_filtradas
            FROM {STREAMING_TABLE}
            WHERE {data_criacao_expr} >= date('{effective_start}')
        """).collect()[0]

        sample_rows = [
            row.asDict()
            for row in spark.sql(f"""
                SELECT
                  DATA_CRIACAO,
                  NUMERO_NOTA,
                  {data_criacao_expr} AS data_criacao_norm
                FROM {STREAMING_TABLE}
                ORDER BY {data_criacao_expr} DESC, DATA_CRIACAO DESC
                LIMIT 5
            """).collect()
        ]

        logger.warning(
            "Diagnóstico source vazio: total_rows=%s, invalidas_data_criacao=%s, min_data=%s, max_data=%s, total_filtradas=%s, effective_start=%s",
            summary_row["total_rows"],
            summary_row["data_criacao_invalidas"],
            summary_row["min_data_criacao"],
            summary_row["max_data_criacao"],
            filtered_row["total_filtradas"],
            effective_start,
        )
        logger.warning("Amostra DATA_CRIACAO (top 5): %s", sample_rows)
    except Exception as diag_error:
        logger.warning("Falha ao gerar diagnóstico de source vazio: %s", diag_error)


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
    # Default TRUE: lê desde sync_start_date quando não houver force_window.
    raw = spark.conf.get("cockpit.sync.ignore_watermark", "true")
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def get_sync_start_date(spark: SparkSession) -> str:
    raw = spark.conf.get("cockpit.sync.start_date", DEFAULT_SYNC_START_DATE)
    parsed = _normalize_iso_date(raw)
    if not parsed:
        logger.warning(
            "Valor inválido em cockpit.sync.start_date=%s. Usando %s.",
            raw,
            DEFAULT_SYNC_START_DATE,
        )
        return DEFAULT_SYNC_START_DATE
    return parsed


def get_pmpl_min_age_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.pm_refresh_min_age_days", str(PMPL_MIN_AGE_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning(
            "Valor inválido em cockpit.sync.pm_refresh_min_age_days=%s. Usando %s.",
            raw,
            PMPL_MIN_AGE_DAYS,
        )
        return PMPL_MIN_AGE_DAYS

    return max(parsed, 0)


def get_pmpl_standalone_window_days(spark: SparkSession) -> int:
    """Janela em dias para importar ordens PMPL standalone da fonte.
    Para backfill completo: cockpit.sync.pmpl_standalone_window_days=365
    """
    raw = spark.conf.get("cockpit.sync.pmpl_standalone_window_days", str(PMPL_STANDALONE_WINDOW_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning(
            "Valor inválido em cockpit.sync.pmpl_standalone_window_days=%s. Usando %s.",
            raw,
            PMPL_STANDALONE_WINDOW_DAYS,
        )
        return PMPL_STANDALONE_WINDOW_DAYS

    return max(parsed, 1)


def create_sync_log(spark: SparkSession) -> str:
    """Cria entrada no sync_log e retorna o ID."""
    sync_id = str(uuid4())
    job_id = spark.conf.get("spark.databricks.job.runId", "manual")
    supabase.table("sync_log").insert({
        "id": sync_id,
        "status": "running",
        "databricks_job_id": str(job_id),
    }).execute()
    return sync_id


def get_watermark() -> str | None:
    """Busca a ultima data_criacao_sap no Supabase (watermark)."""
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


def get_bootstrap_mode(spark: SparkSession) -> str:
    raw = _as_clean_text(spark.conf.get("cockpit.sync.bootstrap_mode", DEFAULT_BOOTSTRAP_MODE))
    mode = (raw or DEFAULT_BOOTSTRAP_MODE).lower()
    if mode not in VALID_BOOTSTRAP_MODES:
        logger.warning(
            "Modo inválido em cockpit.sync.bootstrap_mode=%s. Usando %s.",
            raw,
            DEFAULT_BOOTSTRAP_MODE,
        )
        return DEFAULT_BOOTSTRAP_MODE
    return mode


def has_bootstrap_checkpoint(sync_start_date: str) -> bool:
    """Verifica se já houve bootstrap bem-sucedido para a origem e período configurados."""
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
            STREAMING_TABLE,
            sync_start_date,
        )
        return False

    logger.info(
        "Bootstrap auto ativado: nenhum checkpoint para tabela=%s e sync_start_date=%s.",
        STREAMING_TABLE,
        sync_start_date,
    )
    return True


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


def read_new_notes(
    spark: SparkSession,
    window_days: int,
    force_window: bool,
    ignore_watermark: bool,
    sync_start_date: str,
    full_bootstrap: bool,
) -> list[dict]:
    """Le notas do streaming table. Usa watermark, com opcao de forcar janela."""
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

    data_criacao_expr = _build_data_criacao_date_expr(spark)

    if full_bootstrap:
        logger.info(
            "Bootstrap inicial ativo: leitura ampla da tabela %s desde %s.",
            STREAMING_TABLE,
            sync_start_date,
        )
        df = spark.sql(f"""
            SELECT *
            FROM (
                SELECT *, {data_criacao_expr} AS DATA_CRIACAO_NORM
                FROM {STREAMING_TABLE}
            ) t
            WHERE DATA_CRIACAO_NORM >= date('{sync_start_date}')
            ORDER BY DATA_CRIACAO_NORM ASC, NUMERO_NOTA ASC
        """)
        effective_start = sync_start_date
    elif force_window:
        window_start_date = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
        effective_start = max(window_start_date, sync_start_date)
        logger.info(
            "Leitura por janela fixa: ultimos %s dias (force_window=%s, inicio_efetivo=%s)",
            window_days,
            force_window,
            effective_start,
        )
    elif ignore_watermark:
        effective_start = sync_start_date
        logger.info("Leitura configurada para ignorar watermark. Inicio efetivo=%s", effective_start)
    else:
        watermark_date = _normalize_iso_date(watermark)
        if watermark_date and _watermark_is_too_future(watermark_date):
            logger.warning(
                "Watermark %s esta no futuro (> %s dia(s)). Ignorando watermark e usando sync_start_date=%s",
                watermark_date,
                MAX_WATERMARK_FUTURE_DAYS,
                sync_start_date,
            )
            watermark_date = None
        if watermark_date:
            effective_start = max(watermark_date, sync_start_date)
            logger.info(
                "Watermark (DATA_CRIACAO): %s | inicio_configurado=%s | inicio_efetivo=%s",
                watermark_date,
                sync_start_date,
                effective_start,
            )
        else:
            effective_start = sync_start_date
            logger.info("Sem watermark válido. Leitura iniciando em %s", effective_start)

    if not full_bootstrap:
        df = spark.sql(f"""
            SELECT *
            FROM (
                SELECT *, {data_criacao_expr} AS DATA_CRIACAO_NORM
                FROM {STREAMING_TABLE}
            ) t
            WHERE DATA_CRIACAO_NORM >= date('{effective_start}')
            ORDER BY DATA_CRIACAO_NORM ASC, NUMERO_NOTA ASC
        """)

    rows = df.collect()
    if not rows:
        diagnostics_start = effective_start or sync_start_date
        _log_empty_result_diagnostics(spark, diagnostics_start, data_criacao_expr)

    notes: list[dict] = []
    missing_centro = 0

    for row in rows:
        row_dict = row.asDict()
        numero = _as_clean_text(row_dict.get("NUMERO_NOTA"))
        if not numero:
            continue

        centro = _extract_centro_from_candidates(row_dict, NOTA_CENTRO_COLUMNS_CANDIDATES)
        if not centro:
            missing_centro += 1

        notes.append({
            "numero_nota": numero,
            "tipo_nota": row_dict.get("TIPO_NOTA"),
            "descricao": row_dict.get("TEXTO_BREVE") or "Sem descrição",
            "descricao_objeto": row_dict.get("TEXTO_DESC_OBJETO"),
            "prioridade": row_dict.get("PRIORIDADE"),
            "tipo_prioridade": row_dict.get("TIPO_PRIORIDADE"),
            "criado_por_sap": row_dict.get("CRIADO_POR"),
            "solicitante": row_dict.get("SOLICITANTE"),
            "data_criacao_sap": str(row_dict["DATA_CRIACAO"]) if row_dict.get("DATA_CRIACAO") else None,
            "data_nota": str(row_dict["DATA_NOTA"]) if row_dict.get("DATA_NOTA") else None,
            "hora_nota": row_dict.get("HORA_NOTA"),
            "ordem_sap": _as_clean_text(row_dict.get("ORDEM")),
            "centro": centro,
            "status_sap": _as_clean_text(row_dict.get("STATUS_OBJ_ADMIN")),
            "conta_fornecedor": row_dict.get("N_CONTA_FORNECEDOR"),
            "autor_nota": row_dict.get("AUTOR_NOTA_QM_PM"),
            "raw_data": json.dumps(row_dict, default=str),
        })

    if missing_centro > 0:
        logger.warning("Notas sem centro no lote lido: %s", missing_centro)

    return notes


def upsert_notes(notes: list[dict], sync_id: str) -> tuple[int, int]:
    """
    Upsert notas no Supabase.
    Retorna (inseridas, atualizadas).
    """
    if not notes:
        return 0, 0

    # Deduplica por numero_nota para evitar violacao de unique em lotes com repeticao.
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
        logger.warning(
            "Notas duplicadas no lote por numero_nota: %s (mantendo ultimo registro por chave).",
            duplicated_count,
        )

    existing_numbers = set()
    numero_notas = [n["numero_nota"] for n in deduped_notes]

    for i in range(0, len(numero_notas), BATCH_SIZE):
        batch = numero_notas[i:i + BATCH_SIZE]
        result = (
            supabase.table("notas_manutencao")
            .select("numero_nota")
            .in_("numero_nota", batch)
            .execute()
        )
        existing_numbers.update(r["numero_nota"] for r in (result.data or []))

    sap_fields = [
        "tipo_nota", "descricao", "descricao_objeto", "prioridade",
        "tipo_prioridade", "criado_por_sap", "solicitante",
        "data_criacao_sap", "data_nota", "hora_nota", "ordem_sap",
        "centro", "status_sap", "conta_fornecedor", "autor_nota",
        "raw_data", "sync_id",
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
        (
            supabase.table("notas_manutencao")
            .upsert(batch, on_conflict="numero_nota")
            .execute()
        )

    inserted_count = sum(1 for note in deduped_notes if note["numero_nota"] not in existing_numbers)
    updated_count = len(deduped_notes) - inserted_count

    if inserted_count:
        logger.info("Inseridas: %s", inserted_count)
    if updated_count:
        logger.info("Atualizadas: %s", updated_count)

    return inserted_count, updated_count


def run_register_orders(sync_id: str) -> tuple[int, int]:
    """Registra ordens detectadas em notas e auto-conclui notas abertas quando aplicável."""
    result = supabase.rpc("registrar_ordens_por_notas", {"p_sync_id": sync_id}).execute()
    row = (result.data or [{}])[0]
    detectadas = int(row.get("ordens_detectadas") or 0)
    auto_concluidas = int(row.get("notas_auto_concluidas") or 0)
    logger.info("Ordens detectadas: %s | Notas auto-concluídas: %s", detectadas, auto_concluidas)
    return detectadas, auto_concluidas


def run_distribution(sync_id: str) -> int:
    """Chama a funcao de distribuição no Supabase."""
    result = supabase.rpc("distribuir_notas", {"p_sync_id": sync_id}).execute()
    distributed = len(result.data) if result.data else 0
    logger.info("Distribuidas: %s", distributed)
    return distributed


def get_orders_for_pmpl_refresh(min_age_days: int = PMPL_MIN_AGE_DAYS) -> list[str]:
    """Lista ordens elegíveis para refresh PMPL (status abertos + ordens sem data_entrada)."""
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


def consolidate_pmpl_status_by_order(spark: SparkSession, ordem_codes: list[str]) -> list[dict]:
    """Consolida um unico status por ordem consultando manutenção.gold.pmpl_pmos."""
    if not ordem_codes:
        return []

    best_by_order: dict[str, dict] = {}

    for i in range(0, len(ordem_codes), PMPL_FETCH_BATCH_SIZE):
        batch = ordem_codes[i:i + PMPL_FETCH_BATCH_SIZE]
        escaped = ", ".join("'" + code.replace("'", "''") + "'" for code in batch)

        df = spark.sql(f"""
            SELECT *
            FROM {PMPL_TABLE}
            WHERE ORDEM IN ({escaped})
        """)

        for row in df.collect():
            row_dict = row.asDict()
            ordem_codigo = _as_clean_text(row_dict.get("ORDEM"))
            if not ordem_codigo:
                continue

            status_raw = _extract_status_raw(row_dict)
            if not status_raw:
                continue

            centro = _extract_centro(row_dict)
            data_entrada = _extract_data_entrada(row_dict)
            tipo_ordem = _as_clean_text(row_dict.get(PMPL_TIPO_ORDEM_COLUMN))
            priority = STATUS_PRIORITY.get(status_raw, 0)

            current = best_by_order.get(ordem_codigo)
            if current is None or priority > current["priority"]:
                best_by_order[ordem_codigo] = {
                    "ordem_codigo": ordem_codigo,
                    "status_raw": status_raw,
                    "centro": centro,
                    "data_entrada": data_entrada or (current.get("data_entrada") if current else None),
                    "tipo_ordem": tipo_ordem or (current.get("tipo_ordem") if current else None),
                    "priority": priority,
                }
            else:
                if current.get("data_entrada") is None and data_entrada is not None:
                    current["data_entrada"] = data_entrada
                if current.get("tipo_ordem") is None and tipo_ordem is not None:
                    current["tipo_ordem"] = tipo_ordem

    updates = [
        {
            "ordem_codigo": v["ordem_codigo"],
            "status_raw": v["status_raw"],
            "centro": v["centro"],
            "data_entrada": v.get("data_entrada"),
            "tipo_ordem": v.get("tipo_ordem"),
        }
        for v in best_by_order.values()
    ]

    logger.info("Updates consolidados de status PMPL: %s", len(updates))

    debug_tipo = spark.conf.get("cockpit.sync.debug_tipo_ordem", "0")
    if str(debug_tipo).strip() == "1":
        from collections import Counter
        tipo_counts = Counter(v.get("tipo_ordem") or "NULL" for v in best_by_order.values())
        logger.info("DEBUG tipo_ordem counts: %s", dict(tipo_counts))
        pmpl_samples = [v["ordem_codigo"] for v in best_by_order.values() if v.get("tipo_ordem") == "PMPL"][:5]
        pmos_samples = [v["ordem_codigo"] for v in best_by_order.values() if (v.get("tipo_ordem") or "") != "PMPL"][:5]
        logger.info("DEBUG PMPL samples (first 5): %s", pmpl_samples)
        logger.info("DEBUG PMOS/NULL samples (first 5): %s", pmos_samples)

    return updates


def push_pmpl_updates(sync_id: str, updates: list[dict]) -> tuple[int, int, int]:
    """Envia updates de status para a RPC de lote."""
    if not updates:
        return 0, 0, 0

    total_recebidas = 0
    ordens_atualizadas = 0
    mudancas_status = 0

    for i in range(0, len(updates), PMPL_RPC_BATCH_SIZE):
        batch = updates[i:i + PMPL_RPC_BATCH_SIZE]
        result = supabase.rpc(
            "atualizar_status_ordens_pmpl_lote",
            {
                "p_updates": batch,
                "p_sync_id": sync_id,
            },
        ).execute()

        row = (result.data or [{}])[0]
        total_recebidas += int(row.get("total_recebidas") or 0)
        ordens_atualizadas += int(row.get("ordens_atualizadas") or 0)
        mudancas_status += int(row.get("mudancas_status") or 0)

    logger.info(
        "PMPL refresh -> recebidas=%s atualizadas=%s mudancas_status=%s",
        total_recebidas,
        ordens_atualizadas,
        mudancas_status,
    )
    return total_recebidas, ordens_atualizadas, mudancas_status


def _build_pmpl_data_entrada_date_expr(spark: SparkSession) -> str:
    """Expressão Spark SQL para extrair data de entrada usando apenas colunas existentes."""
    existing = _resolve_existing_columns(spark, PMPL_TABLE, PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES)
    if not existing:
        logger.warning(
            "Nenhuma coluna de data candidata encontrada na tabela %s. Candidatas=%s",
            PMPL_TABLE,
            PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES,
        )
    return _build_date_expr_from_columns(existing)


def read_standalone_pmpl_orders(
    spark: SparkSession,
    window_days: int,
    sync_start_date: str,
    ignore_watermark: bool,
) -> list[dict]:
    """Lê ordens PMPL e PMOS da fonte para importação standalone (sem nota correspondente).

    Usa window_days para definir a janela de leitura a partir de hoje,
    limitada pelo sync_start_date configurado.
    Para backfill completo configure cockpit.sync.pmpl_standalone_window_days=365.
    """
    if ignore_watermark:
        effective_start = sync_start_date
    else:
        window_start = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
        effective_start = max(window_start, sync_start_date)

    data_expr = _build_pmpl_data_entrada_date_expr(spark)
    tipos_escaped = ", ".join(f"'{t}'" for t in PMPL_STANDALONE_TIPO_ORDENS)
    logger.info(
        "Lendo ordens standalone (%s): effective_start=%s, window_days=%s, ignore_watermark=%s",
        tipos_escaped,
        effective_start,
        window_days,
        ignore_watermark,
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

    logger.info(
        "Ordens PMPL standalone lidas: %s (effective_start=%s, window_days=%s)",
        len(orders),
        effective_start,
        window_days,
    )
    return orders


def push_standalone_pmpl_orders(sync_id: str, orders: list[dict]) -> tuple[int, int, int]:
    """Importa ordens PMPL standalone no Supabase via RPC (upsert por ordem_codigo)."""
    if not orders:
        return 0, 0, 0

    total_recebidas = 0
    inseridas = 0
    atualizadas = 0

    for i in range(0, len(orders), PMPL_STANDALONE_BATCH_SIZE):
        batch = orders[i:i + PMPL_STANDALONE_BATCH_SIZE]
        result = supabase.rpc(
            "importar_ordens_pmpl_standalone",
            {
                "p_orders": batch,
                "p_sync_id": sync_id,
            },
        ).execute()

        row = (result.data or [{}])[0]
        total_recebidas += int(row.get("total_recebidas") or 0)
        inseridas       += int(row.get("inseridas")       or 0)
        atualizadas     += int(row.get("atualizadas")     or 0)

    logger.info(
        "PMPL standalone import -> recebidas=%s inseridas=%s atualizadas=%s",
        total_recebidas,
        inseridas,
        atualizadas,
    )
    return total_recebidas, inseridas, atualizadas


def read_orders_document_reference(spark: SparkSession) -> tuple[list[dict], dict]:
    """Lê referência de ordens (ORDEM/TIPO_DOCUMENTO_VENDAS) da fonte silver."""
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
        len(rows),
        len(references),
        invalid_order,
        invalid_type,
        conflicts,
    )

    return references, {
        "total_rows": len(rows),
        "valid_rows": len(references),
        "invalid_order": invalid_order,
        "invalid_type": invalid_type,
        "conflicts": conflicts,
    }


def upsert_orders_document_reference(sync_id: str, references: list[dict]) -> tuple[int, int]:
    """Upsert da referência de tipo de documento por ordem normalizada."""
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
        (
            supabase.table("ordens_tipo_documento_referencia")
            .upsert(batch, on_conflict="ordem_codigo_norm")
            .execute()
        )

    inserted_count = sum(1 for item in references if item["ordem_codigo_norm"] not in existing_orders)
    updated_count = len(references) - inserted_count

    logger.info(
        "Referência ORDEM/TIPO upsert: inseridas=%s, atualizadas=%s",
        inserted_count,
        updated_count,
    )
    return inserted_count, updated_count


def read_orders_maintenance_reference(spark: SparkSession) -> tuple[list[dict], dict]:
    """Lê referência de ordens/notas/tipo/texto/centro da fonte silver."""
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
        len(rows),
        len(references),
        invalid_order,
        invalid_type,
        dedupe_replaced,
        dedupe_discarded,
    )

    return references, {
        "total_rows": len(rows),
        "valid_rows": len(references),
        "invalid_order": invalid_order,
        "invalid_type": invalid_type,
        "dedupe_replaced": dedupe_replaced,
        "dedupe_discarded": dedupe_discarded,
    }


def upsert_orders_maintenance_reference(sync_id: str, references: list[dict]) -> tuple[int, int]:
    """Upsert da referência de manutenção por ordem normalizada."""
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
        (
            supabase.table("ordens_manutencao_referencia")
            .upsert(batch, on_conflict="ordem_codigo_norm")
            .execute()
        )

    inserted_count = sum(1 for item in references if item["ordem_codigo_norm"] not in existing_orders)
    updated_count = len(references) - inserted_count

    logger.info(
        "Referência manutenção upsert: inseridas=%s, atualizadas=%s",
        inserted_count,
        updated_count,
    )
    return inserted_count, updated_count


def run_orders_maintenance_reference_enrichment() -> dict:
    """Enriquece ordens_notas_acompanhamento via referência de manutenção."""
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
        metrics["ordens_atualizadas_total"],
        metrics["tipo_ordem_atualizadas"],
        metrics["centro_preenchidos"],
        metrics["numero_nota_preenchidas"],
    )
    return metrics


def finalize_sync_log(
    sync_id: str,
    read_count: int,
    inserted: int,
    updated: int,
    distributed: int,
    metadata: dict | None = None,
    error: str | None = None,
):
    """Atualiza sync_log com resultado final."""
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


# ----- Execução Principal -----
def main():
    spark = SparkSession.builder.getOrCreate()
    window_days = get_sync_window_days(spark)
    force_window = should_force_window(spark)
    ignore_watermark = should_ignore_watermark(spark)
    sync_start_date = get_sync_start_date(spark)
    bootstrap_mode = get_bootstrap_mode(spark)
    pmpl_min_age_days = get_pmpl_min_age_days(spark)
    pmpl_standalone_window_days = get_pmpl_standalone_window_days(spark)

    try:
        supabase.table("sync_log").select("id").limit(1).execute()
        logger.info("Conexão com Supabase OK. sync_log acessivel.")
    except Exception as e:
        logger.error("FALHA na conexão com Supabase: %s", e)
        logger.error("URL: %s", SUPABASE_URL)
        logger.error("Verifique se esta usando a SERVICE_ROLE_KEY (não a anon key)")
        raise

    sync_id = create_sync_log(spark)
    logger.info("Sync iniciado: %s", sync_id)

    orders_ref_v2_status = "not_run"
    orders_ref_v2_failure_streak = 0
    orders_ref_v2_error: str | None = None
    orders_ref_v2_metrics = {
        "total_rows": 0,
        "valid_rows": 0,
        "invalid_order": 0,
        "invalid_type": 0,
        "dedupe_replaced": 0,
        "dedupe_discarded": 0,
    }
    ordens_ref_v2_inseridas = 0
    ordens_ref_v2_atualizadas = 0
    orders_ref_v2_enrichment_metrics = {
        "ordens_atualizadas_total": 0,
        "tipo_ordem_atualizadas": 0,
        "centro_preenchidos": 0,
        "numero_nota_preenchidas": 0,
    }

    try:
        full_bootstrap = should_run_full_bootstrap(bootstrap_mode, sync_start_date)
        notes = read_new_notes(
            spark,
            window_days=window_days,
            force_window=force_window,
            ignore_watermark=ignore_watermark,
            sync_start_date=sync_start_date,
            full_bootstrap=full_bootstrap,
        )
        logger.info("Lidas: %s notas do streaming", len(notes))

        inserted, updated = upsert_notes(notes, sync_id)

        ordens_detectadas, notas_auto_concluidas = run_register_orders(sync_id)

        distributed = run_distribution(sync_id)

        # Importa ordens PMPL standalone (sem nota correspondente) direto da fonte
        standalone_orders = read_standalone_pmpl_orders(
            spark,
            pmpl_standalone_window_days,
            sync_start_date,
            ignore_watermark=ignore_watermark,
        )
        _, pmpl_standalone_inseridas, pmpl_standalone_atualizadas = push_standalone_pmpl_orders(sync_id, standalone_orders)

        eligible_orders = get_orders_for_pmpl_refresh(min_age_days=pmpl_min_age_days)
        pmpl_updates = consolidate_pmpl_status_by_order(spark, eligible_orders)
        _, ordens_status_atualizadas, mudancas_status = push_pmpl_updates(sync_id, pmpl_updates)

        orders_document_reference, orders_document_metrics = read_orders_document_reference(spark)
        ordens_tipo_ref_inseridas, ordens_tipo_ref_atualizadas = upsert_orders_document_reference(
            sync_id,
            orders_document_reference,
        )

        # Enriquece tipo_ordem para ordens sem tipo (vinculadas a notas via qmel_clean)
        result_enrich = supabase.rpc("enriquecer_tipo_ordem_por_referencia", {}).execute()
        tipo_enriquecidas = int(result_enrich.data or 0)
        logger.info("tipo_ordem enriquecidas: %s", tipo_enriquecidas)

        # Fonte v2 (manutencao.silver.selecao_ordens_manutencao):
        # dedupe por completude + data_extracao e enriquecimento direto da tabela operacional.
        try:
            orders_ref_v2_reference, orders_ref_v2_metrics = read_orders_maintenance_reference(spark)
            ordens_ref_v2_inseridas, ordens_ref_v2_atualizadas = upsert_orders_maintenance_reference(
                sync_id,
                orders_ref_v2_reference,
            )
            orders_ref_v2_enrichment_metrics = run_orders_maintenance_reference_enrichment()
            orders_ref_v2_status = "success"
            orders_ref_v2_failure_streak = 0
            orders_ref_v2_error = None
            set_orders_ref_v2_failure_streak(0, None)
        except Exception as ref_v2_exc:
            previous_streak = get_orders_ref_v2_failure_streak()
            orders_ref_v2_failure_streak = previous_streak + 1
            orders_ref_v2_error = f"{type(ref_v2_exc).__name__}: {ref_v2_exc}"
            orders_ref_v2_status = "error_tolerated"
            set_orders_ref_v2_failure_streak(orders_ref_v2_failure_streak, orders_ref_v2_error)

            logger.error(
                "Falha na referência v2 de manutenção (tolerância ativa): streak=%s limite=%s erro=%s",
                orders_ref_v2_failure_streak,
                ORDERS_REF_V2_TOLERATED_FAILURES,
                orders_ref_v2_error,
            )
            if orders_ref_v2_failure_streak > ORDERS_REF_V2_TOLERATED_FAILURES:
                raise RuntimeError(
                    "Falha recorrente na referência v2 de manutenção "
                    f"por {orders_ref_v2_failure_streak} ciclos consecutivos."
                ) from ref_v2_exc

        metadata = {
            "window_days": window_days,
            "force_window": force_window,
            "ignore_watermark": ignore_watermark,
            "sync_start_date": sync_start_date,
            "streaming_table": STREAMING_TABLE,
            "bootstrap_mode": bootstrap_mode,
            "full_bootstrap": full_bootstrap,
            "pmpl_min_age_days": pmpl_min_age_days,
            "pmpl_standalone_window_days": pmpl_standalone_window_days,
            "pmpl_standalone_inseridas": pmpl_standalone_inseridas,
            "pmpl_standalone_atualizadas": pmpl_standalone_atualizadas,
            "ordens_detectadas": ordens_detectadas,
            "ordens_status_atualizadas": ordens_status_atualizadas,
            "ordens_mudanca_status": mudancas_status,
            "notas_auto_concluidas": notas_auto_concluidas,
            "ordens_elegiveis_pmpl": len(eligible_orders),
            "ordens_tipo_ref_total_rows": orders_document_metrics["total_rows"],
            "ordens_tipo_ref_valid_rows": orders_document_metrics["valid_rows"],
            "ordens_tipo_ref_invalid_order": orders_document_metrics["invalid_order"],
            "ordens_tipo_ref_invalid_type": orders_document_metrics["invalid_type"],
            "ordens_tipo_ref_conflicts": orders_document_metrics["conflicts"],
            "ordens_tipo_ref_inseridas": ordens_tipo_ref_inseridas,
            "ordens_tipo_ref_atualizadas": ordens_tipo_ref_atualizadas,
            "tipo_ordem_enriquecidas": tipo_enriquecidas,
            "orders_ref_v2_status": orders_ref_v2_status,
            "orders_ref_v2_failure_streak": orders_ref_v2_failure_streak,
            "orders_ref_v2_error": orders_ref_v2_error,
            "orders_ref_v2_total_rows": orders_ref_v2_metrics["total_rows"],
            "orders_ref_v2_valid_rows": orders_ref_v2_metrics["valid_rows"],
            "orders_ref_v2_invalid_order": orders_ref_v2_metrics["invalid_order"],
            "orders_ref_v2_invalid_type": orders_ref_v2_metrics["invalid_type"],
            "orders_ref_v2_dedupe_replaced": orders_ref_v2_metrics["dedupe_replaced"],
            "orders_ref_v2_dedupe_discarded": orders_ref_v2_metrics["dedupe_discarded"],
            "orders_ref_v2_inseridas": ordens_ref_v2_inseridas,
            "orders_ref_v2_atualizadas": ordens_ref_v2_atualizadas,
            "orders_ref_v2_ordens_atualizadas_total": orders_ref_v2_enrichment_metrics["ordens_atualizadas_total"],
            "orders_ref_v2_tipo_ordem_atualizadas": orders_ref_v2_enrichment_metrics["tipo_ordem_atualizadas"],
            "orders_ref_v2_centro_preenchidos": orders_ref_v2_enrichment_metrics["centro_preenchidos"],
            "orders_ref_v2_numero_nota_preenchidas": orders_ref_v2_enrichment_metrics["numero_nota_preenchidas"],
        }

        finalize_sync_log(
            sync_id,
            read_count=len(notes),
            inserted=inserted,
            updated=updated,
            distributed=distributed,
            metadata=metadata,
        )

        logger.info("Sync concluido com sucesso")

    except Exception as e:
        logger.error("Sync falhou: %s: %s", type(e).__name__, e)
        try:
            finalize_sync_log(
                sync_id,
                read_count=0,
                inserted=0,
                updated=0,
                distributed=0,
                metadata={
                    "window_days": window_days,
                    "force_window": force_window,
                    "ignore_watermark": ignore_watermark,
                    "sync_start_date": sync_start_date,
                    "streaming_table": STREAMING_TABLE,
                    "bootstrap_mode": bootstrap_mode,
                    "pmpl_min_age_days": pmpl_min_age_days,
                    "pmpl_standalone_window_days": pmpl_standalone_window_days,
                    "orders_ref_v2_status": orders_ref_v2_status,
                    "orders_ref_v2_failure_streak": orders_ref_v2_failure_streak,
                    "orders_ref_v2_error": orders_ref_v2_error,
                    "orders_ref_v2_total_rows": orders_ref_v2_metrics["total_rows"],
                    "orders_ref_v2_valid_rows": orders_ref_v2_metrics["valid_rows"],
                    "orders_ref_v2_invalid_order": orders_ref_v2_metrics["invalid_order"],
                    "orders_ref_v2_invalid_type": orders_ref_v2_metrics["invalid_type"],
                    "orders_ref_v2_dedupe_replaced": orders_ref_v2_metrics["dedupe_replaced"],
                    "orders_ref_v2_dedupe_discarded": orders_ref_v2_metrics["dedupe_discarded"],
                    "orders_ref_v2_inseridas": ordens_ref_v2_inseridas,
                    "orders_ref_v2_atualizadas": ordens_ref_v2_atualizadas,
                    "orders_ref_v2_ordens_atualizadas_total": orders_ref_v2_enrichment_metrics["ordens_atualizadas_total"],
                    "orders_ref_v2_tipo_ordem_atualizadas": orders_ref_v2_enrichment_metrics["tipo_ordem_atualizadas"],
                    "orders_ref_v2_centro_preenchidos": orders_ref_v2_enrichment_metrics["centro_preenchidos"],
                    "orders_ref_v2_numero_nota_preenchidas": orders_ref_v2_enrichment_metrics["numero_nota_preenchidas"],
                },
                error=str(e),
            )
        except Exception:
            logger.error("Não conseguiu gravar erro no sync_log")
        raise


main()
