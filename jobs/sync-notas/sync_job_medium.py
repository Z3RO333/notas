"""Databricks entrypoint: medium sync for PMPL refresh and standalone orders."""

import logging
import re
import subprocess
from datetime import datetime, timedelta, timezone
from uuid import uuid4

subprocess.check_call(["pip", "install", "supabase"])

from pyspark.sql import SparkSession
from supabase import Client, create_client


SUPABASE_URL = dbutils.secrets.get(scope="cockpit", key="SUPABASE_URL")
SUPABASE_SERVICE_KEY = dbutils.secrets.get(scope="cockpit", key="SUPABASE_SERVICE_ROLE_KEY")
PMPL_TABLE = "manutencao.gold.pmpl_pmos"

OPEN_STATUS = {"aberta", "em_tratativa", "desconhecido"}
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
PMPL_FETCH_BATCH_SIZE = 300
PMPL_RPC_BATCH_SIZE = 200
PMPL_STANDALONE_BATCH_SIZE = 500
PMPL_STANDALONE_TIPO_ORDENS = ("PMPL", "PMOS")
PMPL_CENTRO_COLUMN = "CENTRO_LOCALIZACAO"
PMPL_TIPO_ORDEM_COLUMN = "TIPO_ORDEM"
PMPL_FORNECEDOR_CODIGO_COLUMN = "FORNECEDOR"
PMPL_TEXTO_BREVE_COLUMNS_CANDIDATES = ["TEXTO_BREVE", "TEXTO_ORDEM", "DESCRICAO_ORDEM"]
PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES = [
    "DATA_ENTRADA",
    "DATA_CRIACAO",
    "DATA_ABERTURA",
    "DT_CRIACAO",
    "DT_ENTRADA",
]

JOB_NAME = "medium"

# Config local deste notebook/arquivo.
MEDIUM_SYNC_START_DATE = "2026-01-01"
MEDIUM_PMPL_STANDALONE_WINDOW_DAYS = 90
MEDIUM_STANDALONE_IGNORE_WATERMARK = False
MEDIUM_PMPL_MIN_AGE_DAYS = 0
MEDIUM_RUN_OWNER_ASSIGNMENT = True
MEDIUM_RUN_OWNER_REALIGN = True
MEDIUM_RUN_COCKPIT_SYNC = True

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_job_medium")


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


def _normalize_ordem_codigo(value) -> str | None:
    text = _as_clean_text(value)
    if not text:
        return None
    if re.fullmatch(r"\d+(\.0+)?", text):
        integer_part = text.split(".", maxsplit=1)[0]
        normalized = integer_part.lstrip("0")
        return normalized or "0"
    return text


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


def _is_missing_rpc_error(exc: Exception, rpc_name: str) -> bool:
    text = str(exc).lower()
    return (
        "pgrst202" in text
        or "42883" in text
        or (rpc_name.lower() in text and ("not found" in text or "does not exist" in text))
    )


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


def _build_pmpl_data_entrada_date_expr(spark: SparkSession) -> str:
    existing = _resolve_existing_columns(spark, PMPL_TABLE, PMPL_DATA_ENTRADA_COLUMNS_CANDIDATES)
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


def get_orders_for_pmpl_refresh(min_age_days: int = MEDIUM_PMPL_MIN_AGE_DAYS) -> list[str]:
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
        ordem_codes.extend(code for code in (_as_clean_text(r.get("ordem_codigo")) for r in rows) if code)
        if len(rows) < page:
            break
        offset += page

    return ordem_codes


def consolidate_pmpl_status_by_order(spark: SparkSession, ordem_codes: list[str]) -> list[dict]:
    if not ordem_codes:
        return []

    best_by_order: dict[str, dict] = {}
    for i in range(0, len(ordem_codes), PMPL_FETCH_BATCH_SIZE):
        batch = ordem_codes[i:i + PMPL_FETCH_BATCH_SIZE]
        escaped = ", ".join("'" + code.replace("'", "''") + "'" for code in batch)
        df = spark.sql(f"SELECT * FROM {PMPL_TABLE} WHERE ORDEM IN ({escaped})")
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
            criado_por_sap_codigo = _as_clean_text(row_dict.get("CRIADOR_POR"))
            priority = STATUS_PRIORITY.get(status_raw, 0)
            current = best_by_order.get(ordem_codigo)

            if current is None or priority > current["priority"]:
                best_by_order[ordem_codigo] = {
                    "ordem_codigo": ordem_codigo,
                    "status_raw": status_raw,
                    "centro": centro,
                    "data_entrada": data_entrada or (current.get("data_entrada") if current else None),
                    "tipo_ordem": tipo_ordem or (current.get("tipo_ordem") if current else None),
                    "criado_por_sap_codigo": criado_por_sap_codigo or (current.get("criado_por_sap_codigo") if current else None),
                    "priority": priority,
                }
            else:
                if current.get("data_entrada") is None and data_entrada is not None:
                    current["data_entrada"] = data_entrada
                if current.get("tipo_ordem") is None and tipo_ordem is not None:
                    current["tipo_ordem"] = tipo_ordem
                if current.get("criado_por_sap_codigo") is None and criado_por_sap_codigo is not None:
                    current["criado_por_sap_codigo"] = criado_por_sap_codigo

    return [
        {
            "ordem_codigo": v["ordem_codigo"],
            "status_raw": v["status_raw"],
            "centro": v["centro"],
            "data_entrada": v.get("data_entrada"),
            "tipo_ordem": v.get("tipo_ordem"),
            "criado_por_sap_codigo": v.get("criado_por_sap_codigo"),
        }
        for v in best_by_order.values()
    ]


def push_pmpl_updates(sync_id: str, updates: list[dict]) -> tuple[int, int, int]:
    if not updates:
        return 0, 0, 0
    total_recebidas = 0
    ordens_atualizadas = 0
    mudancas_status = 0
    for i in range(0, len(updates), PMPL_RPC_BATCH_SIZE):
        batch = updates[i:i + PMPL_RPC_BATCH_SIZE]
        result = supabase.rpc("atualizar_status_ordens_pmpl_lote", {"p_updates": batch, "p_sync_id": sync_id}).execute()
        row = (result.data or [{}])[0]
        total_recebidas += int(row.get("total_recebidas") or 0)
        ordens_atualizadas += int(row.get("ordens_atualizadas") or 0)
        mudancas_status += int(row.get("mudancas_status") or 0)
    return total_recebidas, ordens_atualizadas, mudancas_status


def read_standalone_pmpl_orders(spark: SparkSession, window_days: int, sync_start_date: str, ignore_watermark: bool) -> list[dict]:
    if ignore_watermark:
        effective_start = sync_start_date
    else:
        window_start = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
        effective_start = max(window_start, sync_start_date)

    data_expr = _build_pmpl_data_entrada_date_expr(spark)
    tipos_escaped = ", ".join(f"'{t}'" for t in PMPL_STANDALONE_TIPO_ORDENS)
    df = spark.sql(f"""
        SELECT *
        FROM {PMPL_TABLE}
        WHERE {PMPL_TIPO_ORDEM_COLUMN} IN ({tipos_escaped})
          AND ORDEM IS NOT NULL
          AND ({data_expr} >= date('{effective_start}') OR {data_expr} IS NULL)
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
        criado_por_sap_codigo = _as_clean_text(row_dict.get("CRIADOR_POR"))
        fornecedor_codigo = _as_clean_text(row_dict.get(PMPL_FORNECEDOR_CODIGO_COLUMN))
        texto_breve = None
        for col in PMPL_TEXTO_BREVE_COLUMNS_CANDIDATES:
            texto_breve = _as_clean_text(row_dict.get(col))
            if texto_breve:
                break

        priority = STATUS_PRIORITY.get(status_raw, 0)
        current = best_by_order.get(ordem_codigo)
        if current is None or priority > current["priority"]:
            best_by_order[ordem_codigo] = {
                "ordem_codigo": ordem_codigo,
                "status_raw": status_raw,
                "centro": centro,
                "data_entrada": data_entrada or (current.get("data_entrada") if current else None),
                "tipo_ordem": tipo_ordem,
                "criado_por_sap_codigo": criado_por_sap_codigo or (current.get("criado_por_sap_codigo") if current else None),
                "fornecedor_codigo": fornecedor_codigo or (current.get("fornecedor_codigo") if current else None),
                "texto_breve": texto_breve or (current.get("texto_breve") if current else None),
                "priority": priority,
            }
        else:
            if current.get("data_entrada") is None and data_entrada is not None:
                current["data_entrada"] = data_entrada
            if current.get("criado_por_sap_codigo") is None and criado_por_sap_codigo is not None:
                current["criado_por_sap_codigo"] = criado_por_sap_codigo
            if current.get("fornecedor_codigo") is None and fornecedor_codigo is not None:
                current["fornecedor_codigo"] = fornecedor_codigo
            if current.get("texto_breve") is None and texto_breve is not None:
                current["texto_breve"] = texto_breve

    return [
        {
            "ordem_codigo": v["ordem_codigo"],
            "status_raw": v["status_raw"],
            "centro": v["centro"],
            "data_entrada": v.get("data_entrada"),
            "tipo_ordem": v.get("tipo_ordem") or "PMPL",
            "criado_por_sap_codigo": v.get("criado_por_sap_codigo"),
            "fornecedor_codigo": v.get("fornecedor_codigo"),
            "texto_breve": v.get("texto_breve"),
        }
        for v in best_by_order.values()
    ]


def push_standalone_pmpl_orders(sync_id: str, orders: list[dict]) -> tuple[int, int, int]:
    if not orders:
        return 0, 0, 0
    total_recebidas = 0
    inseridas = 0
    atualizadas = 0
    for i in range(0, len(orders), PMPL_STANDALONE_BATCH_SIZE):
        batch = orders[i:i + PMPL_STANDALONE_BATCH_SIZE]
        result = supabase.rpc("importar_ordens_pmpl_standalone", {"p_orders": batch, "p_sync_id": sync_id}).execute()
        row = (result.data or [{}])[0]
        total_recebidas += int(row.get("total_recebidas") or 0)
        inseridas += int(row.get("inseridas") or 0)
        atualizadas += int(row.get("atualizadas") or 0)
    return total_recebidas, inseridas, atualizadas


def run_standalone_owner_assignment() -> dict:
    try:
        result = supabase.rpc("atribuir_responsavel_ordens_standalone", {}).execute()
    except Exception as exc:
        if _is_statement_timeout_error(exc):
            return {
                "status": "error_tolerated",
                "error": f"{type(exc).__name__}: {exc}",
                "total_candidatas": 0,
                "responsaveis_preenchidos": 0,
                "atribuicoes_criado_por": 0,
                "atribuicoes_refrigeracao": 0,
                "atribuicoes_pmpl_config": 0,
                "atribuicoes_fallback": 0,
                "sem_destino": 0,
            }
        raise
    row = _extract_single_rpc_row(result)
    return {
        "status": "success",
        "error": None,
        "total_candidatas": int(row.get("total_candidatas") or 0),
        "responsaveis_preenchidos": int(row.get("responsaveis_preenchidos") or 0),
        "atribuicoes_criado_por": int(row.get("atribuicoes_criado_por") or 0),
        "atribuicoes_refrigeracao": int(row.get("atribuicoes_refrigeracao") or 0),
        "atribuicoes_pmpl_config": int(row.get("atribuicoes_pmpl_config") or 0),
        "atribuicoes_fallback": int(row.get("atribuicoes_fallback") or 0),
        "sem_destino": int(row.get("sem_destino") or 0),
    }


def run_standalone_pmpl_owner_realign() -> dict:
    rpc_name = "realinhar_responsavel_pmpl_standalone"
    try:
        result = supabase.rpc(rpc_name, {}).execute()
    except Exception as exc:
        if _is_missing_rpc_error(exc, rpc_name):
            return {
                "status": "rpc_missing",
                "error": None,
                "rpc_disponivel": False,
                "total_candidatas": 0,
                "reatribuicoes": 0,
                "destino_id": None,
            }
        if _is_statement_timeout_error(exc):
            return {
                "status": "error_tolerated",
                "error": f"{type(exc).__name__}: {exc}",
                "rpc_disponivel": True,
                "total_candidatas": 0,
                "reatribuicoes": 0,
                "destino_id": None,
            }
        raise
    row = _extract_single_rpc_row(result)
    return {
        "status": "success",
        "error": None,
        "rpc_disponivel": True,
        "total_candidatas": int(row.get("total_candidatas") or 0),
        "reatribuicoes": int(row.get("reatribuicoes") or 0),
        "destino_id": row.get("destino_id"),
    }


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
    current_step = "startup"
    pmpl_standalone_inseridas = 0
    pmpl_standalone_atualizadas = 0
    ordens_status_atualizadas = 0
    ordens_mudanca_status = 0
    standalone_orders: list[dict] = []
    eligible_orders: list[str] = []

    standalone_owner_metrics: dict[str, object] = {
        "status": "not_run",
        "error": None,
        "total_candidatas": 0,
        "responsaveis_preenchidos": 0,
        "atribuicoes_criado_por": 0,
        "atribuicoes_refrigeracao": 0,
        "atribuicoes_pmpl_config": 0,
        "atribuicoes_fallback": 0,
        "sem_destino": 0,
    }
    standalone_pmpl_realign_metrics: dict[str, object] = {
        "status": "not_run",
        "error": None,
        "rpc_disponivel": False,
        "total_candidatas": 0,
        "reatribuicoes": 0,
        "destino_id": None,
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
        current_step = "read_standalone_pmpl_orders"
        standalone_orders = read_standalone_pmpl_orders(
            spark,
            window_days=MEDIUM_PMPL_STANDALONE_WINDOW_DAYS,
            sync_start_date=MEDIUM_SYNC_START_DATE,
            ignore_watermark=MEDIUM_STANDALONE_IGNORE_WATERMARK,
        )

        current_step = "push_standalone_pmpl_orders"
        _, pmpl_standalone_inseridas, pmpl_standalone_atualizadas = push_standalone_pmpl_orders(sync_id, standalone_orders)

        current_step = "get_orders_for_pmpl_refresh"
        eligible_orders = get_orders_for_pmpl_refresh(MEDIUM_PMPL_MIN_AGE_DAYS)

        current_step = "consolidate_pmpl_status_by_order"
        pmpl_updates = consolidate_pmpl_status_by_order(spark, eligible_orders)

        current_step = "push_pmpl_updates"
        _, ordens_status_atualizadas, ordens_mudanca_status = push_pmpl_updates(sync_id, pmpl_updates)

        if MEDIUM_RUN_OWNER_ASSIGNMENT:
            current_step = "run_standalone_owner_assignment"
            standalone_owner_metrics = run_standalone_owner_assignment()

        if MEDIUM_RUN_OWNER_REALIGN:
            current_step = "run_standalone_pmpl_owner_realign"
            standalone_pmpl_realign_metrics = run_standalone_pmpl_owner_realign()

        if MEDIUM_RUN_COCKPIT_SYNC:
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
                "sync_start_date": MEDIUM_SYNC_START_DATE,
                "pmpl_table": PMPL_TABLE,
                "pmpl_standalone_window_days": MEDIUM_PMPL_STANDALONE_WINDOW_DAYS,
                "pmpl_standalone_ignore_watermark": MEDIUM_STANDALONE_IGNORE_WATERMARK,
                "pmpl_min_age_days": MEDIUM_PMPL_MIN_AGE_DAYS,
                "pmpl_standalone_lidas": len(standalone_orders),
                "pmpl_standalone_inseridas": pmpl_standalone_inseridas,
                "pmpl_standalone_atualizadas": pmpl_standalone_atualizadas,
                "ordens_elegiveis_pmpl": len(eligible_orders),
                "ordens_status_atualizadas": ordens_status_atualizadas,
                "ordens_mudanca_status": ordens_mudanca_status,
                "standalone_owner_status": standalone_owner_metrics.get("status"),
                "standalone_owner_error": standalone_owner_metrics.get("error"),
                "standalone_owner_total_candidatas": standalone_owner_metrics.get("total_candidatas"),
                "standalone_owner_preenchidos": standalone_owner_metrics.get("responsaveis_preenchidos"),
                "standalone_owner_atribuicoes_criado_por": standalone_owner_metrics.get("atribuicoes_criado_por"),
                "standalone_owner_atribuicoes_refrigeracao": standalone_owner_metrics.get("atribuicoes_refrigeracao"),
                "standalone_owner_atribuicoes_pmpl_config": standalone_owner_metrics.get("atribuicoes_pmpl_config"),
                "standalone_owner_atribuicoes_fallback": standalone_owner_metrics.get("atribuicoes_fallback"),
                "standalone_owner_sem_destino": standalone_owner_metrics.get("sem_destino"),
                "standalone_pmpl_realign_status": standalone_pmpl_realign_metrics.get("status"),
                "standalone_pmpl_realign_error": standalone_pmpl_realign_metrics.get("error"),
                "standalone_pmpl_realign_rpc_disponivel": standalone_pmpl_realign_metrics.get("rpc_disponivel"),
                "standalone_pmpl_realign_total_candidatas": standalone_pmpl_realign_metrics.get("total_candidatas"),
                "standalone_pmpl_realign_reatribuicoes": standalone_pmpl_realign_metrics.get("reatribuicoes"),
                "standalone_pmpl_realign_destino_id": standalone_pmpl_realign_metrics.get("destino_id"),
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
                "sync_start_date": MEDIUM_SYNC_START_DATE,
                "pmpl_table": PMPL_TABLE,
                "pmpl_standalone_window_days": MEDIUM_PMPL_STANDALONE_WINDOW_DAYS,
                "pmpl_standalone_ignore_watermark": MEDIUM_STANDALONE_IGNORE_WATERMARK,
                "pmpl_min_age_days": MEDIUM_PMPL_MIN_AGE_DAYS,
                "pmpl_standalone_lidas": len(standalone_orders),
                "pmpl_standalone_inseridas": pmpl_standalone_inseridas,
                "pmpl_standalone_atualizadas": pmpl_standalone_atualizadas,
                "ordens_elegiveis_pmpl": len(eligible_orders),
                "ordens_status_atualizadas": ordens_status_atualizadas,
                "ordens_mudanca_status": ordens_mudanca_status,
                "standalone_owner_status": standalone_owner_metrics.get("status"),
                "standalone_owner_error": standalone_owner_metrics.get("error"),
                "standalone_pmpl_realign_status": standalone_pmpl_realign_metrics.get("status"),
                "standalone_pmpl_realign_error": standalone_pmpl_realign_metrics.get("error"),
                "cockpit_sync_status": cockpit_sync_metrics.get("status"),
                "cockpit_sync_error": cockpit_sync_metrics.get("error"),
            },
            error=str(exc),
        )
        raise


if __name__ == "__main__":
    main()
