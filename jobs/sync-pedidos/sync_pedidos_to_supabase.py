"""
Sync job: Databricks cabecalho_documento_compras + itens_documento_compras
          → Supabase pedidos_compra + pedidos_compra_itens.

Roda manualmente ou via Databricks Jobs scheduler.

ATENÇÃO — nomes de coluna diferentes entre as tabelas Databricks:
  - cabecalho: chave = DOCUMENTO_COMPRAS,    MES_EXTRACAO = date
  - itens:     chave = DOCUMENTO_DE_COMPRAS, MES_EXTRACAO = string "202501" (YYYYMM)
"""
import os
import sys
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # type: ignore[attr-defined]
logging.basicConfig(stream=sys.stdout, level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _ensure(pkg: str, mod: str | None = None) -> None:
    import importlib, subprocess
    try:
        importlib.import_module(mod or pkg)
    except ModuleNotFoundError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg])


_ensure("databricks-sql-connector==4.2.5", "databricks.sql")
_ensure("supabase==2.10.0", "supabase")
_ensure("python-dotenv==1.2.2", "dotenv")

# Carrega .env quando rodando localmente (fora do Databricks)
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
except Exception:
    pass

import databricks.sql as dbsql
from supabase import create_client, Client

# ── Configuração ──────────────────────────────────────────────────────────────

def _secret(key: str) -> str:
    try:
        return dbutils.secrets.get(scope="cockpit", key=key)  # type: ignore[name-defined]
    except Exception:
        val = os.getenv(key)
        if not val:
            raise RuntimeError(f"Secret '{key}' não encontrado (env var ou scope cockpit).")
        return val


DATABRICKS_HOST  = os.getenv("DATABRICKS_SERVER_HOSTNAME", "adb-926216925051160.0.azuredatabricks.net")
DATABRICKS_PATH  = os.getenv("DATABRICKS_HTTP_PATH", "/sql/1.0/warehouses/ead9637a3263a02e")
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN") or _secret("DATABRICKS_TOKEN")
SUPABASE_URL     = os.getenv("SUPABASE_URL") or _secret("SUPABASE_URL")
SUPABASE_KEY     = os.getenv("SUPABASE_SERVICE_KEY") or _secret("SUPABASE_SERVICE_ROLE_KEY")

HEADER_TABLE = "manutencao.silver.cabecalho_documento_compras"
ITEMS_TABLE  = "manutencao.silver.itens_documento_compras"
TARGET_PURCHASING_GROUP = "112"
TARGET_DOCUMENT_START = "2026-01-01"
BATCH_H      = 500
BATCH_I      = 500

STATUS_MAP = {"02": "em_aberto", "03": "cancelado", "05": "encerrado"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _f(val) -> float | None:
    if val is None:
        return None
    try:
        return float(Decimal(str(val)))
    except (InvalidOperation, ValueError):
        return None


def _s(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def _normalize_supplier(val) -> str | None:
    supplier = _s(val)
    if supplier is None:
        return None
    normalized = supplier.lstrip("0")
    return normalized or "0"


def _batches(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


# ── Clientes ──────────────────────────────────────────────────────────────────

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_db():
    return dbsql.connect(
        server_hostname=DATABRICKS_HOST,
        http_path=DATABRICKS_PATH,
        access_token=DATABRICKS_TOKEN,
    )


# ── Busca mapa SAP → admin ────────────────────────────────────────────────────

def fetch_sap_admin_map(supabase: Client) -> dict[str, str]:
    """Retorna {sap_codigo: administrador_id}."""
    resp = supabase.table("sap_user_admin_map").select("sap_codigo,administrador_id").execute()
    return {row["sap_codigo"]: row["administrador_id"] for row in (resp.data or [])}


# ── Busca cabeçalhos ──────────────────────────────────────────────────────────

def fetch_headers(
    conn,
    sap_admin_map: dict[str, str],
    sync_run_id: str,
    source_last_seen_at: str,
) -> list[dict]:
    """
    Colunas reais do Databricks (verificadas via DESCRIBE):
      DOCUMENTO_COMPRAS, GRUPO_COMPRADORES, ORGANIZACAO_COMPRAS,
      CRIADO_POR, FORNECEDOR, DATA_CRIACAO, DATA_DOCUMENTO,
      VALOR_TOTAL_LIB, STATUS_PROC, TIPO_DOCUMENTO_COMPRA,
      BK_EXTRACAO, MES_EXTRACAO (string YYYYMM), DATA_EXTRACAO.

    A deduplicacao ocorre antes do filtro do grupo comprador. Isso evita manter
    como ativo um documento cujo snapshot mais recente deixou o grupo 112.
    """
    cursor = conn.cursor()
    cursor.execute(f"""
        WITH ranked AS (
          SELECT
            c.*,
            ROW_NUMBER() OVER (
              PARTITION BY c.DOCUMENTO_COMPRAS
              ORDER BY
                c.MES_EXTRACAO DESC NULLS LAST,
                c.DATA_EXTRACAO DESC NULLS LAST,
                c.BK_EXTRACAO DESC NULLS LAST
            ) AS source_rank
          FROM {HEADER_TABLE} c
        )
        SELECT
          c.DOCUMENTO_COMPRAS,
          c.GRUPO_COMPRADORES,
          c.ORGANIZACAO_COMPRAS,
          c.CRIADO_POR,
          c.FORNECEDOR,
          c.DATA_CRIACAO,
          c.DATA_DOCUMENTO,
          CAST(c.VALOR_TOTAL_LIB AS DOUBLE)     AS VALOR_TOTAL_LIB,
          c.STATUS_PROC,
          c.TIPO_DOCUMENTO_COMPRA,
          c.BK_EXTRACAO,
          c.MES_EXTRACAO,
          c.DATA_EXTRACAO
        FROM ranked c
        WHERE c.source_rank = 1
          AND REGEXP_REPLACE(
                TRIM(COALESCE(c.GRUPO_COMPRADORES, '')),
                '^0+',
                ''
              ) = '{TARGET_PURCHASING_GROUP}'
          AND c.DATA_DOCUMENTO >= DATE '{TARGET_DOCUMENT_START}'
          AND c.DATA_DOCUMENTO <= current_date()
        ORDER BY c.DOCUMENTO_COMPRAS
    """)
    cols = [d[0].upper() for d in cursor.description]
    rows = []
    for row in cursor.fetchall():
        r = dict(zip(cols, row))
        sap = _s(r.get("CRIADO_POR"))
        admin_id = sap_admin_map.get(sap or "")
        documento = _s(r.get("DOCUMENTO_COMPRAS"))
        if not documento:
            continue
        status_raw = _s(r.get("STATUS_PROC"))
        mes = _s(r.get("MES_EXTRACAO"))  # string "202501"
        data_criacao = r.get("DATA_CRIACAO")
        data_doc = r.get("DATA_DOCUMENTO")
        data_extracao = r.get("DATA_EXTRACAO")
        rows.append({
            "documento_compras":   documento,
            "administrador_id":    admin_id,
            "criador_admin_id":    admin_id,
            "sap_codigo":          sap,
            "fornecedor":          _normalize_supplier(r.get("FORNECEDOR")),
            "grupo_compradores":   _s(r.get("GRUPO_COMPRADORES")),
            "organizacao_compras": _s(r.get("ORGANIZACAO_COMPRAS")),
            "status_proc_raw":     status_raw,
            "data_criacao":        str(data_criacao) if data_criacao else None,
            "data_documento":      str(data_doc) if data_doc else None,
            "valor_liquido_total": _f(r.get("VALOR_TOTAL_LIB")),
            "status":              STATUS_MAP.get(status_raw or "", "em_aberto"),
            "tipo_documento":      _s(r.get("TIPO_DOCUMENTO_COMPRA")),
            "mes_extracao":        mes,
            "source_bk_extracao":  _s(r.get("BK_EXTRACAO")),
            "source_data_extracao": str(data_extracao) if data_extracao else None,
            "source_sync_run_id":  sync_run_id,
            "source_last_seen_at": source_last_seen_at,
            "source_active":       True,
        })
    cursor.close()
    return rows


# ── Busca itens ───────────────────────────────────────────────────────────────

def fetch_items(
    conn,
    sync_run_id: str,
    source_last_seen_at: str,
) -> list[dict]:
    """
    Busca os itens dos documentos cujo cabecalho atual pertence ao grupo 112.
    Coluna chave: DOCUMENTO_DE_COMPRAS (≠ DOCUMENTO_COMPRAS do cabeçalho).
    Cada (documento, item) e deduplicado de forma deterministica pelas colunas
    de proveniencia da extracao.

    CODIGO_DE_ELIMINACAO no SAP (LOEKZ): quando preenchido, o item está marcado
    para exclusão. Valores observados: 'L' (~99% dos casos), 'S', 'X'.
    """
    cursor = conn.cursor()
    cursor.execute(f"""
        WITH header_ranked AS (
          SELECT
            h.*,
            ROW_NUMBER() OVER (
              PARTITION BY h.DOCUMENTO_COMPRAS
              ORDER BY
                h.MES_EXTRACAO DESC NULLS LAST,
                h.DATA_EXTRACAO DESC NULLS LAST,
                h.BK_EXTRACAO DESC NULLS LAST
            ) AS source_rank
          FROM {HEADER_TABLE} h
        ),
        docs_112 AS (
          SELECT DOCUMENTO_COMPRAS
          FROM header_ranked
          WHERE source_rank = 1
            AND REGEXP_REPLACE(
                  TRIM(COALESCE(GRUPO_COMPRADORES, '')),
                  '^0+',
                  ''
                ) = '{TARGET_PURCHASING_GROUP}'
            AND DATA_DOCUMENTO >= DATE '{TARGET_DOCUMENT_START}'
            AND DATA_DOCUMENTO <= current_date()
        ),
        item_ranked AS (
          SELECT
            i.*,
            ROW_NUMBER() OVER (
              PARTITION BY i.DOCUMENTO_DE_COMPRAS, i.ITEM
              ORDER BY
                i.MES_EXTRACAO DESC NULLS LAST,
                i.DATA_EXTRACAO DESC NULLS LAST,
                i.BK_EXTRACAO DESC NULLS LAST
            ) AS source_rank
          FROM {ITEMS_TABLE} i
          INNER JOIN docs_112 d
            ON d.DOCUMENTO_COMPRAS = i.DOCUMENTO_DE_COMPRAS
        )
        SELECT
          i.DOCUMENTO_DE_COMPRAS,
          CAST(i.ITEM AS STRING)                AS ITEM,
          i.FORNECEDOR,
          i.TEXTO_BREVE,
          i.CODIGO_MATERIAL,
          i.GRUPO_DE_MERCADORIAS,
          CAST(i.QUANTIDADE_PEDIDO AS DOUBLE)   AS QUANTIDADE_PEDIDO,
          i.UM_PEDIDO,
          CAST(i.PRECO_LIQUIDO AS DOUBLE)       AS PRECO_LIQUIDO,
          CAST(i.VALOR_LIQUIDO AS DOUBLE)       AS VALOR_LIQUIDO,
          i.CENTRO,
          i.REQUISICAO_DE_COMPRA,
          i.CODIGO_DE_ELIMINACAO,
          i.ULT_MODIF_ID_DIA,
          i.BK_EXTRACAO,
          i.MES_EXTRACAO,
          i.DATA_EXTRACAO
        FROM item_ranked i
        WHERE i.source_rank = 1
        ORDER BY i.DOCUMENTO_DE_COMPRAS, i.ITEM
    """)
    cols = [d[0].upper() for d in cursor.description]
    rows = []
    for row in cursor.fetchall():
        r = dict(zip(cols, row))
        doc = _s(r.get("DOCUMENTO_DE_COMPRAS"))
        item = _s(r.get("ITEM"))
        if not doc or not item:
            continue
        ultima_modificacao = r.get("ULT_MODIF_ID_DIA")
        data_extracao = r.get("DATA_EXTRACAO")
        rows.append({
            "documento_compras": doc,
            "item_numero":       item,
            "fornecedor_fallback": _normalize_supplier(r.get("FORNECEDOR")),
            "descricao":         _s(r.get("TEXTO_BREVE")),
            "codigo_material":   _s(r.get("CODIGO_MATERIAL")),
            "grupo_mercadoria":  _s(r.get("GRUPO_DE_MERCADORIAS")),
            "quantidade":        _f(r.get("QUANTIDADE_PEDIDO")),
            "unidade_medida":    _s(r.get("UM_PEDIDO")),
            "preco_unitario":    _f(r.get("PRECO_LIQUIDO")),
            "valor_liquido":     _f(r.get("VALOR_LIQUIDO")),
            "centro":            _s(r.get("CENTRO")),
            "requisicao_compra": _s(r.get("REQUISICAO_DE_COMPRA")),
            "excluido":          _s(r.get("CODIGO_DE_ELIMINACAO")) is not None,
            "ultima_modificacao_source": str(ultima_modificacao) if ultima_modificacao else None,
            "source_bk_extracao": _s(r.get("BK_EXTRACAO")),
            "source_mes_extracao": _s(r.get("MES_EXTRACAO")),
            "source_data_extracao": str(data_extracao) if data_extracao else None,
            "source_sync_run_id": sync_run_id,
            "source_last_seen_at": source_last_seen_at,
            "source_active": True,
        })
    cursor.close()
    return rows


def apply_item_fallbacks(headers: list[dict], items: list[dict]) -> None:
    fornecedor_by_doc: dict[str, str] = {}
    # Agregados por documento: total de itens e quantos estao ativos (nao excluidos)
    item_stats: dict[str, dict[str, int]] = {}
    for item in items:
        doc = item.get("documento_compras")
        if not doc:
            continue
        fornecedor = item.get("fornecedor_fallback")
        if fornecedor and doc not in fornecedor_by_doc:
            fornecedor_by_doc[doc] = fornecedor
        stats = item_stats.setdefault(doc, {"total": 0, "ativos": 0})
        stats["total"] += 1
        if not item.get("excluido"):
            stats["ativos"] += 1

    filled = 0
    downgraded = 0
    for header in headers:
        doc = header.get("documento_compras") or ""
        if not header.get("fornecedor"):
            fallback = fornecedor_by_doc.get(doc)
            if fallback:
                header["fornecedor"] = fallback
                filled += 1

        # Regra de status efetivo: se o cabecalho esta em_aberto e todos os itens
        # estao marcados para exclusao no SAP, o pedido nao e mais um "aberto real".
        # Reescrevemos para encerrado.
        stats = item_stats.get(doc)
        if (
            header.get("status_proc_raw") == "02"
            and header.get("status") == "em_aberto"
            and stats is not None
            and stats["total"] > 0
            and stats["ativos"] == 0
        ):
            header["status"] = "encerrado"
            downgraded += 1

    for item in items:
        item.pop("fornecedor_fallback", None)

    if filled:
        log.info(f"Fornecedores preenchidos via itens: {filled}")
    if downgraded:
        log.info(f"Pedidos downgrade em_aberto -> encerrado (todos itens excluidos): {downgraded}")


# ── Upsert ────────────────────────────────────────────────────────────────────

def upsert_headers(supabase: Client, headers: list[dict]) -> int:
    """Grava o run em staging; a RPC preserva realocacoes ao publica-lo."""
    total = 0
    for batch in _batches(headers, BATCH_H):
        supabase.table("pedidos_compra_112_staging").upsert(
            batch, on_conflict="source_sync_run_id,documento_compras"
        ).execute()
        total += len(batch)
    log.info(f"Cabeçalhos upserted: {total}/{len(headers)}")
    return total


def upsert_items(supabase: Client, items: list[dict]) -> int:
    total = 0
    for batch in _batches(items, BATCH_I):
        supabase.table("pedidos_compra_itens_112_staging").upsert(
            batch, on_conflict="source_sync_run_id,documento_compras,item_numero"
        ).execute()
        total += len(batch)
    log.info(f"Itens upserted: {total}")
    return total


def recompute_effective_statuses(supabase: Client, documentos: list[str]) -> int:
    """Recalcula status efetivo em lotes antes de publicar o snapshot."""
    adjusted = 0
    for batch in _batches(documentos, 500):
        resp = supabase.rpc(
            "recompute_pedidos_compra_status_for",
            {"p_documentos": batch},
        ).execute()
        adjusted += int(resp.data or 0)
    log.info(f"Recompute de status no servidor: {adjusted} pedidos ajustados")
    return adjusted


def finalize_snapshot(
    supabase: Client,
    sync_run_id: str,
    expected_headers: int,
    expected_items: int,
) -> dict:
    """Publica o run somente depois que todos os upserts foram concluidos."""
    resp = supabase.rpc(
        "finalizar_snapshot_pedidos_compra_112",
        {
            "p_sync_run_id": sync_run_id,
            "p_expected_headers": expected_headers,
            "p_expected_items": expected_items,
        },
    ).execute()
    result = resp.data or {}
    log.info(f"Snapshot 112 finalizado: {result}")
    return result


# ── Ponto de entrada ──────────────────────────────────────────────────────────

def run():
    sync_run_id = str(uuid.uuid4())
    source_last_seen_at = datetime.now(timezone.utc).isoformat()
    log.info(f"Iniciando sync pedidos de compra do grupo 112 (run={sync_run_id})")
    supabase = get_supabase()

    sap_admin_map = fetch_sap_admin_map(supabase)
    log.info(f"Mapa SAP-Admin carregado: {len(sap_admin_map)} registros")
    if not sap_admin_map:
        log.warning("sap_user_admin_map vazio — pedidos serao carregados com criador nao mapeado")

    with get_db() as conn:
        headers = fetch_headers(conn, sap_admin_map, sync_run_id, source_last_seen_at)
        log.info(f"Cabeçalhos encontrados: {len(headers)}")
        if not headers:
            log.error("Snapshot 112 vazio — abortando sem finalizar/inativar o snapshot anterior")
            return
        mapped_headers = sum(1 for h in headers if h.get("criador_admin_id"))
        unknown_statuses = sum(
            1 for h in headers if h.get("status_proc_raw") not in STATUS_MAP
        )
        log.info(
            "Cobertura de criadores: %s mapeados, %s nao mapeados",
            mapped_headers,
            len(headers) - mapped_headers,
        )
        if unknown_statuses:
            log.warning(f"Cabecalhos com STATUS_PROC desconhecido/vazio: {unknown_statuses}")

        documentos = [h["documento_compras"] for h in headers if h["documento_compras"]]
        items = fetch_items(conn, sync_run_id, source_last_seen_at)
        log.info(f"Itens encontrados: {len(items)}")
        if not items:
            log.error("Snapshot 112 sem itens — abortando antes de qualquer upsert")
            return
        apply_item_fallbacks(headers, items)

    upsert_headers(supabase, headers)
    upsert_items(supabase, items)
    finalize_snapshot(supabase, sync_run_id, len(headers), len(items))
    recompute_effective_statuses(supabase, documentos)

    log.info(f"Sync concluído com sucesso (run={sync_run_id})")


if __name__ == "__main__":
    run()
