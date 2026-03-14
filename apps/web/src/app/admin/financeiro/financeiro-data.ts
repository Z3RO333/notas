import type {
  FinanceiroEvolucaoMes,
  FinanceiroKpiSummary,
  FinanceiroOrdemRow,
  FinanceiroRankingRow,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'
import { FINANCEIRO_MONTH_LABELS } from './financeiro-format'

export function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function buildSummary(tipoOrdem: FinanceiroTipoOrdem, rows: FinanceiroOrdemRow[]): FinanceiroKpiSummary {
  const totalOrdens = rows.length
  const ordensComCustoReal = rows.filter((row) => row.tem_custo_real).length
  const custoRealizado = rows.reduce((sum, row) => sum + toNumber(row.valor_realizado), 0)
  const custoPrevistoPendente = rows.reduce((sum, row) => sum + toNumber(row.valor_previsto_pendente), 0)

  return {
    tipo_ordem: tipoOrdem,
    total_ordens: totalOrdens,
    ordens_com_custo_real: ordensComCustoReal,
    custo_realizado: custoRealizado,
    custo_previsto_pendente: custoPrevistoPendente,
    ticket_medio_realizado: ordensComCustoReal > 0 ? custoRealizado / ordensComCustoReal : 0,
    cobertura_percentual: totalOrdens > 0 ? (ordensComCustoReal / totalOrdens) * 100 : 0,
  }
}

export function buildMonthlyEvolution(rows: FinanceiroOrdemRow[]): FinanceiroEvolucaoMes[] {
  const grouped = new Map<string, FinanceiroEvolucaoMes>()

  for (const row of rows) {
    const ano = toNumber(row.competencia_ano)
    const mes = toNumber(row.competencia_mes)
    if (!ano || !mes) continue

    const key = `${ano}-${String(mes).padStart(2, '0')}`
    const existing = grouped.get(key)

    if (existing) {
      existing.realizado += toNumber(row.valor_realizado)
      existing.previsto_pendente += toNumber(row.valor_previsto_pendente)
      existing.total_gasto = existing.realizado
      existing.compromisso_total = existing.realizado + existing.previsto_pendente
      continue
    }

    const realizado = toNumber(row.valor_realizado)
    const previstoPendente = toNumber(row.valor_previsto_pendente)

    grouped.set(key, {
      ano,
      mes,
      label: `${FINANCEIRO_MONTH_LABELS[mes] ?? mes}/${String(ano).slice(2)}`,
      realizado,
      previsto_pendente: previstoPendente,
      total_gasto: realizado,
      compromisso_total: realizado + previstoPendente,
    })
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row)
}

export function buildRanking(
  rows: FinanceiroOrdemRow[],
  resolveKey: (row: FinanceiroOrdemRow) => string,
  limit: number,
): FinanceiroRankingRow[] {
  const grouped = new Map<string, FinanceiroRankingRow>()

  for (const row of rows) {
    const key = resolveKey(row).trim() || 'Sem classificacao'
    const current = grouped.get(key)
    if (current) {
      current.realizado += toNumber(row.valor_realizado)
      current.previsto_pendente += toNumber(row.valor_previsto_pendente)
      current.total_gasto = current.realizado
      current.compromisso_total = current.realizado + current.previsto_pendente
      continue
    }

    const realizado = toNumber(row.valor_realizado)
    const previstoPendente = toNumber(row.valor_previsto_pendente)

    grouped.set(key, {
      nome: key,
      realizado,
      previsto_pendente: previstoPendente,
      total_gasto: realizado,
      compromisso_total: realizado + previstoPendente,
    })
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.total_gasto - left.total_gasto)
    .slice(0, limit)
}
