"""
Sincroniza Data modif. e Status da ordem do Excel SAP para ordens_notas_acompanhamento.

Atualiza por ordem_codigo:
  - status_atualizado_em   <- Data modif.
  - status_ordem_raw       <- Status da ordem
  - data_entrada           <- Data de entrada (quando disponível)
  - tipo_ordem             <- Tipo de ordem
  - centro                 <- Cen.localiz.
  - denominacao_unidade    <- Denominação

Uso:
  python scripts/upload_ordens_data_modif.py
  python scripts/upload_ordens_data_modif.py C:/caminho/ordens.xlsx
  python scripts/upload_ordens_data_modif.py --mes 3 --ano 2026
  python scripts/upload_ordens_data_modif.py --mes 3 --ano 2026 --dry-run
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from datetime import timezone
from pathlib import Path

import pandas as pd
import requests


def _normalize_status(value: str) -> str:
    """Converte status do Excel para o formato dos arrays no RPC.
    Ex: 'Avaliação da Execução' → 'AVALIACAO_DA_EXECUCAO'
        'Aguardando Faturamento (NF)' → 'AGUARDANDO_FATURAMENTO_NF'
    """
    # Remove acentos via NFKD
    sem_acento = "".join(
        ch for ch in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(ch)
    )
    # Substitui não-alfanumérico por underscore, colapsa e remove bordas
    normalizado = re.sub(r"[^A-Za-z0-9]+", "_", sem_acento).strip("_")
    return normalizado.upper()

# ── Credenciais ──────────────────────────────────────────────────────────────

def _load_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    return env


_env = _load_env(Path(__file__).parent.parent / ".env")
SUPABASE_URL = _env.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = _env.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL ou SUPABASE_SERVICE_KEY não encontrados no .env")

_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

DEFAULT_XLSX = Path.home() / "Downloads" / "ordens_sap.xlsx"
BATCH_SIZE = 500

# ── Parse ─────────────────────────────────────────────────────────────────────

def _find_col(columns: list[str], candidates: list[str]) -> str | None:
    lower = {c.strip().lower(): c for c in columns}
    for cand in candidates:
        found = lower.get(cand.lower())
        if found:
            return found
    return None


def parse_excel(
    path: str,
    mes: int | None = None,
    ano: int | None = None,
) -> list[dict]:
    print(f"Lendo {path}...")
    df = pd.read_excel(path)
    print(f"  Shape: {df.shape}")

    cols = list(df.columns)

    ordem_col = _find_col(cols, ["Ordem", "ORDEM", "Order"])
    status_col = _find_col(cols, ["Status da ordem", "Status ordem", "STATUS_ORDEM"])
    modif_col  = _find_col(cols, ["Data modif.", "Data modif", "DATA_MODIF", "Dt.modif."])
    entrada_col = _find_col(cols, ["Data de entrada", "Data entrada", "DATA_ENTRADA"])
    tipo_ordem_col = _find_col(cols, ["Tipo de ordem", "Tipo ordem", "TIPO_ORDEM"])
    centro_col = _find_col(cols, ["Cen.localiz.", "Cen.localiz", "Centro", "CENTRO"])
    denominacao_col = _find_col(cols, ["Denominação", "Denominacao", "DENOMINACAO", "Nome Loja"])

    if not ordem_col:
        raise ValueError(f"Coluna 'Ordem' não encontrada. Disponíveis: {cols}")
    if not modif_col:
        raise ValueError(f"Coluna 'Data modif.' não encontrada. Disponíveis: {cols}")

    print(
        "  Colunas:"
        f" ordem='{ordem_col}' | status='{status_col}' | modif='{modif_col}' | entrada='{entrada_col}'"
        f" | tipo='{tipo_ordem_col}' | centro='{centro_col}' | denominacao='{denominacao_col}'"
    )

    # Garante tipo datetime
    df[modif_col] = pd.to_datetime(df[modif_col], errors="coerce")
    if entrada_col:
        df[entrada_col] = pd.to_datetime(df[entrada_col], errors="coerce")

    # Filtro por mês/ano de Data modif.
    if ano:
        df = df[df[modif_col].dt.year == ano]
    if mes:
        df = df[df[modif_col].dt.month == mes]

    print(f"  Linhas após filtro (mes={mes}, ano={ano}): {len(df)}")

    records = []
    skipped = 0

    for _, row in df.iterrows():
        raw_ordem = row.get(ordem_col)
        if pd.isna(raw_ordem):
            skipped += 1
            continue

        ordem_codigo = str(int(raw_ordem)) if isinstance(raw_ordem, float) else str(raw_ordem).strip()
        if not ordem_codigo:
            skipped += 1
            continue

        modif_val = row.get(modif_col)
        if pd.isna(modif_val):
            skipped += 1
            continue

        # Converte para ISO 8601 UTC
        ts = pd.Timestamp(modif_val)
        if ts.tzinfo is None:
            ts = ts.tz_localize(timezone.utc)
        status_atualizado_em = ts.isoformat()

        rec: dict = {
            "ordem_codigo": ordem_codigo,
            "status_atualizado_em": status_atualizado_em,
        }

        if status_col:
            status_raw = str(row.get(status_col) or "").strip()
            if status_raw and status_raw.lower() not in ("nan", "none", ""):
                rec["status_ordem_raw"] = _normalize_status(status_raw)

        if tipo_ordem_col:
            tipo_ordem = str(row.get(tipo_ordem_col) or "").strip()
            if tipo_ordem and tipo_ordem.lower() not in ("nan", "none", ""):
                rec["tipo_ordem"] = tipo_ordem.upper()

        if centro_col:
            centro = str(row.get(centro_col) or "").strip()
            if centro and centro.lower() not in ("nan", "none", ""):
                rec["centro"] = centro

        if denominacao_col:
            denominacao = str(row.get(denominacao_col) or "").strip()
            if denominacao and denominacao.lower() not in ("nan", "none", ""):
                rec["denominacao_unidade"] = denominacao

        if entrada_col:
            entrada_val = row.get(entrada_col)
            if not pd.isna(entrada_val):
                ts_e = pd.Timestamp(entrada_val)
                if ts_e.tzinfo is None:
                    ts_e = ts_e.tz_localize(timezone.utc)
                rec["data_entrada"] = ts_e.isoformat()

        records.append(rec)

    print(f"  Registros válidos: {len(records)} | ignorados: {skipped}")
    return records


# ── Upload ────────────────────────────────────────────────────────────────────

def upload(records: list[dict], dry_run: bool = False) -> dict:
    if not records:
        print("Nenhum registro para enviar.")
        return {"updated": 0, "not_found": 0}

    if dry_run:
        print(f"[DRY-RUN] Enviaria {len(records)} registros. Exemplo:")
        for r in records[:3]:
            print(f"  {r}")
        return {"updated": 0, "not_found": 0}

    upsert_headers = {
        **_HEADERS,
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    # PostgREST exige que todos os objetos no batch tenham as mesmas chaves
    all_keys = {k for r in records for k in r}
    records = [{k: r.get(k) for k in all_keys} for r in records]

    sent = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/ordens_notas_acompanhamento",
            headers=upsert_headers,
            params={"on_conflict": "ordem_codigo"},
            json=batch,
        )
        if not resp.ok:
            print(f"  ERRO lote {i // BATCH_SIZE + 1}: {resp.status_code} {resp.text[:200]}")
            resp.raise_for_status()
        sent += len(batch)
        print(f"  Upsert lote {i // BATCH_SIZE + 1}: {len(batch)} registros")

    return {"updated": sent}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sincroniza Data modif. das ordens SAP")
    parser.add_argument("path", nargs="?", default=str(DEFAULT_XLSX), help="Caminho do .xlsx")
    parser.add_argument("--mes",  type=int, help="Filtrar por mês de Data modif. (1-12)")
    parser.add_argument("--ano",  type=int, help="Filtrar por ano de Data modif.")
    parser.add_argument("--dry-run", action="store_true", help="Simula sem enviar ao Supabase")
    args = parser.parse_args()

    records = parse_excel(args.path, mes=args.mes, ano=args.ano)

    print(f"\nEnviando {len(records)} registros ao Supabase...")
    result = upload(records, dry_run=args.dry_run)
    print(f"\nConcluído: {result}")


if __name__ == "__main__":
    main()
