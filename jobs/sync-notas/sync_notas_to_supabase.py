"""
Databricks Job: Sync notas de manutencao do streaming para o Supabase.
Roda a cada 5 minutos via Databricks Jobs scheduler.

Fluxo:
  1. Le notas novas/atualizadas de manutencao.streaming.notas_qm
  2. Upsert no Supabase (tabela notas_manutencao)
  3. Chama funcao de distribuicao para notas novas
  4. Registra resultado no sync_log
"""

import subprocess
subprocess.check_call(["pip", "install", "supabase"])

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from pyspark.sql import SparkSession
from supabase import create_client, Client

# ----- Configuracao -----
# Secrets armazenados no Databricks scope "cockpit"
SUPABASE_URL = dbutils.secrets.get(scope="cockpit", key="SUPABASE_URL")
SUPABASE_SERVICE_KEY = dbutils.secrets.get(scope="cockpit", key="SUPABASE_SERVICE_ROLE_KEY")
STREAMING_TABLE = "manutencao.streaming.notas_qm"

# service_role bypassa RLS - intencional para job de sistema
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_notas")


def create_sync_log() -> str:
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


def get_synced_notas() -> set:
    """Busca todos os numero_nota ja no Supabase (para idempotencia)."""
    all_numbers = set()
    offset = 0
    batch_size = 1000
    while True:
        result = (
            supabase.table("notas_manutencao")
            .select("numero_nota")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        if not result.data:
            break
        all_numbers.update(r["numero_nota"] for r in result.data)
        if len(result.data) < batch_size:
            break
        offset += batch_size
    return all_numbers


def read_new_notes(spark: SparkSession) -> list[dict]:
    """Le notas do streaming table. Usa DATA_CRIACAO como watermark."""
    watermark = get_watermark()

    if watermark:
        logger.info(f"Watermark (DATA_CRIACAO): {watermark}")
        # Pega notas a partir da data do watermark (inclui o dia, pra pegar notas novas do mesmo dia)
        df = spark.sql(f"""
            SELECT * FROM {STREAMING_TABLE}
            WHERE DATA_CRIACAO >= '{watermark}'
            ORDER BY DATA_CRIACAO ASC, NUMERO_NOTA ASC
        """)
    else:
        # Primeira execucao: pega tudo dos ultimos 30 dias
        logger.info("Sem watermark. Buscando ultimos 30 dias.")
        df = spark.sql(f"""
            SELECT * FROM {STREAMING_TABLE}
            WHERE DATA_CRIACAO >= current_date() - INTERVAL 30 DAYS
            ORDER BY DATA_CRIACAO ASC, NUMERO_NOTA ASC
        """)

    rows = df.collect()
    notes = []

    for row in rows:
        row_dict = row.asDict()
        numero = str(row_dict.get("NUMERO_NOTA", "")).strip()
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
            "ordem_sap": row_dict.get("ORDEM"),
            "centro": row_dict.get("CENTRO_MATERIAL"),
            "status_sap": row_dict.get("STATUS_OBJ_ADMIN"),
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

    # Adiciona sync_id
    for note in notes:
        note["sync_id"] = sync_id

    # Verifica quais ja existem
    existing_numbers = set()
    numero_notas = [n["numero_nota"] for n in notes if n["numero_nota"]]

    for i in range(0, len(numero_notas), 100):
        batch = numero_notas[i:i + 100]
        result = (
            supabase.table("notas_manutencao")
            .select("numero_nota")
            .in_("numero_nota", batch)
            .execute()
        )
        existing_numbers.update(r["numero_nota"] for r in result.data)

    new_notes = [n for n in notes if n["numero_nota"] and n["numero_nota"] not in existing_numbers]
    update_notes = [n for n in notes if n["numero_nota"] and n["numero_nota"] in existing_numbers]

    # Insert novas (status='nova', administrador_id=NULL automaticamente)
    if new_notes:
        for i in range(0, len(new_notes), 500):
            batch = new_notes[i:i + 500]
            supabase.table("notas_manutencao").insert(batch).execute()
        logger.info(f"Inseridas: {len(new_notes)}")

    # Update existentes (so campos SAP, nunca sobrescreve status/admin/tratativa)
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
        logger.info(f"Atualizadas: {len(update_notes)}")

    return len(new_notes), len(update_notes)


def run_distribution(sync_id: str) -> int:
    """Chama a funcao de distribuicao no Supabase."""
    result = supabase.rpc("distribuir_notas", {"p_sync_id": sync_id}).execute()
    distributed = len(result.data) if result.data else 0
    logger.info(f"Distribuidas: {distributed}")
    return distributed


def finalize_sync_log(
    sync_id: str,
    read_count: int,
    inserted: int,
    updated: int,
    distributed: int,
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
    if error:
        data["erro_mensagem"] = error[:2000]

    supabase.table("sync_log").update(data).eq("id", sync_id).execute()


# ----- Execucao Principal -----
def main():
    # Teste de conexao antes de tudo
    try:
        test = supabase.table("sync_log").select("id").limit(1).execute()
        logger.info(f"Conexao com Supabase OK. sync_log acessivel.")
    except Exception as e:
        logger.error(f"FALHA na conexao com Supabase: {e}")
        logger.error(f"URL: {SUPABASE_URL}")
        logger.error("Verifique se esta usando a SERVICE_ROLE_KEY (nao a anon key)")
        raise

    sync_id = create_sync_log()
    logger.info(f"Sync iniciado: {sync_id}")

    try:
        spark = SparkSession.builder.getOrCreate()

        # 1. Le notas novas
        notes = read_new_notes(spark)
        logger.info(f"Lidas: {len(notes)} notas do streaming")

        # 2. Upsert no Supabase
        inserted, updated = upsert_notes(notes, sync_id)

        # 3. Distribui notas novas
        distributed = run_distribution(sync_id)

        # 4. Log final
        finalize_sync_log(sync_id, len(notes), inserted, updated, distributed)
        logger.info("Sync concluido com sucesso")

    except Exception as e:
        logger.error(f"Sync falhou: {type(e).__name__}: {e}")
        # Tenta gravar o erro no sync_log
        try:
            finalize_sync_log(sync_id, 0, 0, 0, 0, error=str(e))
        except Exception:
            logger.error("Nao conseguiu gravar erro no sync_log")
        raise


main()
