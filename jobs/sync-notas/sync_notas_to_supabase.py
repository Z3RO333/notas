"""
Databricks Job: Sync notas de manutencao do streaming para o Supabase.
Roda a cada 5 minutos via Databricks Jobs scheduler.

Fluxo:
  1. Le notas novas/atualizadas de manutencao.streaming.notas_qm
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
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pyspark.sql import SparkSession
from supabase import Client, create_client

# ----- Configuracao -----
# Secrets armazenados no Databricks scope "cockpit"
SUPABASE_URL = dbutils.secrets.get(scope="cockpit", key="SUPABASE_URL")
SUPABASE_SERVICE_KEY = dbutils.secrets.get(scope="cockpit", key="SUPABASE_SERVICE_ROLE_KEY")
STREAMING_TABLE = "manutencao.streaming.notas_qm"
PMPL_TABLE = "manutencao.gold.pmpl_pmos"

VALID_WINDOWS = {30, 90, 180}
DEFAULT_WINDOW_DAYS = 30
BATCH_SIZE = 100
PMPL_FETCH_BATCH_SIZE = 300
PMPL_RPC_BATCH_SIZE = 200
PMPL_MIN_AGE_DAYS = 0

OPEN_STATUS = {"aberta", "em_tratativa", "desconhecido"}

STATUS_PRIORITY = {
    # Finais primeiro
    "CANCELADO": 5,
    "CONCLUIDO": 4,
    "AGUARDANDO_FATURAMENTO_NF": 4,
    "EXECUCAO_SATISFATORIO": 4,
    # Em andamento
    "EM_PROCESSAMENTO": 3,
    "EM_EXECUCAO": 3,
    "AVALIACAO_DA_EXECUCAO": 3,
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

CENTRO_COLUMNS_CANDIDATES = [
    "CENTRO_LOCALIZACAO",
    "CENTRO_MATERIAL",
    "CENTRO",
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


def get_sync_window_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.window_days", str(DEFAULT_WINDOW_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning("Janela invalida em cockpit.sync.window_days=%s. Usando %s.", raw, DEFAULT_WINDOW_DAYS)
        return DEFAULT_WINDOW_DAYS

    if parsed not in VALID_WINDOWS:
        logger.warning("Janela %s nao suportada. Usando %s.", parsed, DEFAULT_WINDOW_DAYS)
        return DEFAULT_WINDOW_DAYS

    return parsed


def should_force_window(spark: SparkSession) -> bool:
    raw = spark.conf.get("cockpit.sync.force_window", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def get_pmpl_min_age_days(spark: SparkSession) -> int:
    raw = spark.conf.get("cockpit.sync.pm_refresh_min_age_days", str(PMPL_MIN_AGE_DAYS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning(
            "Valor invalido em cockpit.sync.pm_refresh_min_age_days=%s. Usando %s.",
            raw,
            PMPL_MIN_AGE_DAYS,
        )
        return PMPL_MIN_AGE_DAYS

    return max(parsed, 0)


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


def read_new_notes(spark: SparkSession, window_days: int, force_window: bool) -> list[dict]:
    """Le notas do streaming table. Usa watermark, com opcao de forcar janela."""
    watermark = get_watermark()

    if watermark and not force_window:
        logger.info("Watermark (DATA_CRIACAO): %s", watermark)
        df = spark.sql(f"""
            SELECT * FROM {STREAMING_TABLE}
            WHERE DATA_CRIACAO >= '{watermark}'
            ORDER BY DATA_CRIACAO ASC, NUMERO_NOTA ASC
        """)
    else:
        logger.info(
            "Leitura por janela fixa: ultimos %s dias (force_window=%s)",
            window_days,
            force_window,
        )
        df = spark.sql(f"""
            SELECT * FROM {STREAMING_TABLE}
            WHERE DATA_CRIACAO >= current_date() - INTERVAL {window_days} DAYS
            ORDER BY DATA_CRIACAO ASC, NUMERO_NOTA ASC
        """)

    rows = df.collect()
    notes: list[dict] = []

    for row in rows:
        row_dict = row.asDict()
        numero = _as_clean_text(row_dict.get("NUMERO_NOTA"))
        if not numero:
            continue

        notes.append({
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
            "ordem_sap": _as_clean_text(row_dict.get("ORDEM")),
            "centro": _as_clean_text(row_dict.get("CENTRO_MATERIAL")),
            "status_sap": _as_clean_text(row_dict.get("STATUS_OBJ_ADMIN")),
            "conta_fornecedor": row_dict.get("N_CONTA_FORNECEDOR"),
            "autor_nota": row_dict.get("AUTOR_NOTA_QM_PM"),
            "raw_data": json.dumps(row_dict, default=str),
        })

    return notes


def upsert_notes(notes: list[dict], sync_id: str) -> tuple[int, int]:
    """
    Upsert notas no Supabase.
    Retorna (inseridas, atualizadas).
    """
    if not notes:
        return 0, 0

    for note in notes:
        note["sync_id"] = sync_id

    existing_numbers = set()
    numero_notas = [n["numero_nota"] for n in notes if n["numero_nota"]]

    for i in range(0, len(numero_notas), BATCH_SIZE):
        batch = numero_notas[i:i + BATCH_SIZE]
        result = (
            supabase.table("notas_manutencao")
            .select("numero_nota")
            .in_("numero_nota", batch)
            .execute()
        )
        existing_numbers.update(r["numero_nota"] for r in (result.data or []))

    new_notes = [n for n in notes if n["numero_nota"] and n["numero_nota"] not in existing_numbers]
    update_notes = [n for n in notes if n["numero_nota"] and n["numero_nota"] in existing_numbers]

    if new_notes:
        for i in range(0, len(new_notes), 500):
            batch = new_notes[i:i + 500]
            supabase.table("notas_manutencao").insert(batch).execute()
        logger.info("Inseridas: %s", len(new_notes))

    sap_fields = [
        "tipo_nota", "descricao", "descricao_objeto", "prioridade",
        "tipo_prioridade", "criado_por_sap", "solicitante",
        "data_criacao_sap", "data_nota", "hora_nota", "ordem_sap",
        "centro", "status_sap", "conta_fornecedor", "autor_nota",
        "raw_data", "sync_id",
    ]

    for note in update_notes:
        update_data = {k: note[k] for k in sap_fields if k in note}
        (
            supabase.table("notas_manutencao")
            .update(update_data)
            .eq("numero_nota", note["numero_nota"])
            .execute()
        )

    if update_notes:
        logger.info("Atualizadas: %s", len(update_notes))

    return len(new_notes), len(update_notes)


def run_register_orders(sync_id: str) -> tuple[int, int]:
    """Registra ordens detectadas em notas e auto-conclui notas abertas quando aplicavel."""
    result = supabase.rpc("registrar_ordens_por_notas", {"p_sync_id": sync_id}).execute()
    row = (result.data or [{}])[0]
    detectadas = int(row.get("ordens_detectadas") or 0)
    auto_concluidas = int(row.get("notas_auto_concluidas") or 0)
    logger.info("Ordens detectadas: %s | Notas auto-concluidas: %s", detectadas, auto_concluidas)
    return detectadas, auto_concluidas


def run_distribution(sync_id: str) -> int:
    """Chama a funcao de distribuicao no Supabase."""
    result = supabase.rpc("distribuir_notas", {"p_sync_id": sync_id}).execute()
    distributed = len(result.data) if result.data else 0
    logger.info("Distribuidas: %s", distributed)
    return distributed


def get_orders_for_pmpl_refresh(min_age_days: int = PMPL_MIN_AGE_DAYS) -> list[str]:
    """Lista ordens elegiveis para atualizacao de status via PMPL."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=min_age_days)
    ordem_codes: list[str] = []
    offset = 0
    page = 1000

    while True:
        result = (
            supabase.table("ordens_notas_acompanhamento")
            .select("ordem_codigo")
            .lte("ordem_detectada_em", cutoff.isoformat())
            .in_("status_ordem", list(OPEN_STATUS))
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

    logger.info("Ordens elegiveis para refresh PMPL: %s", len(ordem_codes))
    return ordem_codes


def _extract_status_raw(row_dict: dict) -> str | None:
    for col in STATUS_COLUMNS_CANDIDATES:
        value = _as_clean_text(row_dict.get(col))
        if value:
            return value.upper().replace(" ", "_")
    return None


def _extract_centro(row_dict: dict) -> str | None:
    for col in CENTRO_COLUMNS_CANDIDATES:
        value = _as_clean_text(row_dict.get(col))
        if value:
            return value
    return None


def consolidate_pmpl_status_by_order(spark: SparkSession, ordem_codes: list[str]) -> list[dict]:
    """Consolida um unico status por ordem consultando manutencao.gold.pmpl_pmos."""
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
            priority = STATUS_PRIORITY.get(status_raw, 0)

            current = best_by_order.get(ordem_codigo)
            if current is None or priority > current["priority"]:
                best_by_order[ordem_codigo] = {
                    "ordem_codigo": ordem_codigo,
                    "status_raw": status_raw,
                    "centro": centro,
                    "priority": priority,
                }

    updates = [
        {
            "ordem_codigo": v["ordem_codigo"],
            "status_raw": v["status_raw"],
            "centro": v["centro"],
        }
        for v in best_by_order.values()
    ]

    logger.info("Updates consolidados de status PMPL: %s", len(updates))
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


# ----- Execucao Principal -----
def main():
    spark = SparkSession.builder.getOrCreate()
    window_days = get_sync_window_days(spark)
    force_window = should_force_window(spark)
    pmpl_min_age_days = get_pmpl_min_age_days(spark)

    try:
        supabase.table("sync_log").select("id").limit(1).execute()
        logger.info("Conexao com Supabase OK. sync_log acessivel.")
    except Exception as e:
        logger.error("FALHA na conexao com Supabase: %s", e)
        logger.error("URL: %s", SUPABASE_URL)
        logger.error("Verifique se esta usando a SERVICE_ROLE_KEY (nao a anon key)")
        raise

    sync_id = create_sync_log(spark)
    logger.info("Sync iniciado: %s", sync_id)

    try:
        notes = read_new_notes(spark, window_days=window_days, force_window=force_window)
        logger.info("Lidas: %s notas do streaming", len(notes))

        inserted, updated = upsert_notes(notes, sync_id)

        ordens_detectadas, notas_auto_concluidas = run_register_orders(sync_id)

        distributed = run_distribution(sync_id)

        eligible_orders = get_orders_for_pmpl_refresh(min_age_days=pmpl_min_age_days)
        pmpl_updates = consolidate_pmpl_status_by_order(spark, eligible_orders)
        _, ordens_status_atualizadas, mudancas_status = push_pmpl_updates(sync_id, pmpl_updates)

        metadata = {
            "window_days": window_days,
            "force_window": force_window,
            "pmpl_min_age_days": pmpl_min_age_days,
            "ordens_detectadas": ordens_detectadas,
            "ordens_status_atualizadas": ordens_status_atualizadas,
            "ordens_mudanca_status": mudancas_status,
            "notas_auto_concluidas": notas_auto_concluidas,
            "ordens_elegiveis_pmpl": len(eligible_orders),
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
                    "pmpl_min_age_days": pmpl_min_age_days,
                },
                error=str(e),
            )
        except Exception:
            logger.error("Nao conseguiu gravar erro no sync_log")
        raise


main()
