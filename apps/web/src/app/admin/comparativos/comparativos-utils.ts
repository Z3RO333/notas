import type {
  ComparativoFinanceiroMes,
  ComparativoFinanceiroResumoAno,
  ComparativoFornecedorMes,
  ComparativoFornecedorResumo,
  ComparativoOrdensMes,
  ComparativoOrdensResumoAno,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'

export type ComparativoTipoOrdemFilter = 'todos' | FinanceiroTipoOrdem
export type OrdersMetricKey = 'total_ordens' | 'ordens_abertas' | 'ordens_executadas'
export type FinanceMetricKey = 'total_gasto' | 'compromisso_total' | 'valor_previsto_pendente'
export type SupplierSortKey = 'nome' | 'total_base' | 'total_comparado' | 'delta_abs' | 'delta_pct'
export type SupplierSortDirection = 'asc' | 'desc'

export const COMPARATIVO_MONTH_LABELS: Record<number, string> = {
  1: 'Jan',
  2: 'Fev',
  3: 'Mar',
  4: 'Abr',
  5: 'Mai',
  6: 'Jun',
  7: 'Jul',
  8: 'Ago',
  9: 'Set',
  10: 'Out',
  11: 'Nov',
  12: 'Dez',
}

export interface ComparativoYearPair {
  availableYears: number[]
  anoBase: number
  anoComparado: number
}

export interface DeltaValue {
  deltaAbs: number
  deltaPct: number | null
}

export interface ComparisonKpiItem extends DeltaValue {
  id: string
  label: string
  anoBase: number
  anoComparado: number
  valorBase: number
  valorComparado: number
}

export interface ComparisonChartRow {
  mes: number
  label: string
  valorBase: number
  valorComparado: number
}

export interface SupplierAnnualComparisonRow extends DeltaValue {
  fornecedorRef: string
  fornecedorCodigo: string | null
  fornecedorNome: string
  ordensBase: number
  ordensComparado: number
  totalBase: number
  totalComparado: number
  realizadoBase: number
  realizadoComparado: number
  pendenteBase: number
  pendenteComparado: number
}

export interface SupplierMonthlyComparisonRow extends DeltaValue {
  key: string
  label: string
  mes: number | null
  totalBase: number
  totalComparado: number
  realizadoBase: number
  realizadoComparado: number
  pendenteBase: number
  pendenteComparado: number
}

function isValidYear(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function listAvailableYears(rawYears: Array<number | string | null | undefined>, nowYear = new Date().getFullYear()): number[] {
  const normalized = Array.from(
    new Set(
      rawYears
        .map((year) => toNumber(year))
        .filter((year) => isValidYear(year))
    )
  ).sort((left, right) => right - left)

  if (normalized.length > 0) return normalized
  return [nowYear, nowYear - 1]
}

export function resolveComparativoYears(params: {
  rawYears: Array<number | string | null | undefined>
  anoBaseParam?: string | number | null
  anoComparadoParam?: string | number | null
  nowYear?: number
}): ComparativoYearPair {
  const nowYear = params.nowYear ?? new Date().getFullYear()
  const availableYears = listAvailableYears(params.rawYears, nowYear)
  const defaultComparado = availableYears[0] ?? nowYear
  const defaultBase = availableYears.find((year) => year !== defaultComparado) ?? (defaultComparado - 1)

  const parsedComparado = toNumber(params.anoComparadoParam)
  const parsedBase = toNumber(params.anoBaseParam)

  const anoComparado = isValidYear(parsedComparado) ? parsedComparado : defaultComparado
  let anoBase = isValidYear(parsedBase) ? parsedBase : defaultBase
  if (anoBase === anoComparado) {
    anoBase = availableYears.find((year) => year !== anoComparado) ?? (anoComparado - 1)
  }

  return {
    availableYears,
    anoBase,
    anoComparado,
  }
}

export function buildDelta(baseValue: number, comparedValue: number): DeltaValue {
  const deltaAbs = comparedValue - baseValue
  if (baseValue === 0 && comparedValue === 0) {
    return { deltaAbs, deltaPct: 0 }
  }
  if (baseValue === 0) {
    return { deltaAbs, deltaPct: null }
  }
  return {
    deltaAbs,
    deltaPct: ((comparedValue - baseValue) / baseValue) * 100,
  }
}

export function formatDeltaPercent(value: number | null): string {
  if (value === null) return 'Sem base'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function resolveFinanceMetricValue(
  row: ComparativoFinanceiroResumoAno | ComparativoFinanceiroMes | undefined,
  metric: FinanceMetricKey,
): number {
  if (!row) return 0
  if (metric === 'compromisso_total') {
    return toNumber(row.total_gasto) + toNumber(row.valor_previsto_pendente)
  }
  if (metric === 'total_gasto') {
    return toNumber(row.total_gasto)
  }
  return toNumber(row.valor_previsto_pendente)
}

export function buildOrdersKpis(
  rows: ComparativoOrdensResumoAno[],
  anoBase: number,
  anoComparado: number,
): ComparisonKpiItem[] {
  const byYear = new Map(rows.map((row) => [row.ano, row]))
  const base = byYear.get(anoBase)
  const compared = byYear.get(anoComparado)

  const metrics: Array<{ key: OrdersMetricKey; id: string; label: string }> = [
    { key: 'total_ordens', id: 'ordens-total', label: 'Total de ordens' },
    { key: 'ordens_abertas', id: 'ordens-abertas', label: 'Ordens abertas' },
    { key: 'ordens_executadas', id: 'ordens-executadas', label: 'Ordens executadas' },
  ]

  return metrics.map((metric) => {
    const valorBase = toNumber(base?.[metric.key])
    const valorComparado = toNumber(compared?.[metric.key])
    const delta = buildDelta(valorBase, valorComparado)

    return {
      id: metric.id,
      label: metric.label,
      anoBase,
      anoComparado,
      valorBase,
      valorComparado,
      ...delta,
    }
  })
}

export function buildFinanceKpis(
  rows: ComparativoFinanceiroResumoAno[],
  anoBase: number,
  anoComparado: number,
): ComparisonKpiItem[] {
  const byYear = new Map(rows.map((row) => [row.ano, row]))
  const base = byYear.get(anoBase)
  const compared = byYear.get(anoComparado)

  const metrics: Array<{ key: FinanceMetricKey; id: string; label: string }> = [
    { key: 'total_gasto', id: 'finance-total', label: 'Gasto realizado' },
    { key: 'compromisso_total', id: 'finance-compromisso', label: 'Compromisso total' },
    { key: 'valor_previsto_pendente', id: 'finance-pendente', label: 'Previsto pendente' },
  ]

  return metrics.map((metric) => {
    const valorBase = resolveFinanceMetricValue(base, metric.key)
    const valorComparado = resolveFinanceMetricValue(compared, metric.key)
    const delta = buildDelta(valorBase, valorComparado)

    return {
      id: metric.id,
      label: metric.label,
      anoBase,
      anoComparado,
      valorBase,
      valorComparado,
      ...delta,
    }
  })
}

export function buildOrdersChartRows(
  rows: ComparativoOrdensMes[],
  anoBase: number,
  anoComparado: number,
  metric: OrdersMetricKey,
): ComparisonChartRow[] {
  const byYearMonth = new Map(rows.map((row) => [`${row.ano}-${row.mes}`, row]))

  return Array.from({ length: 12 }, (_, index) => {
    const mes = index + 1
    const base = byYearMonth.get(`${anoBase}-${mes}`)
    const compared = byYearMonth.get(`${anoComparado}-${mes}`)

    return {
      mes,
      label: COMPARATIVO_MONTH_LABELS[mes] ?? String(mes),
      valorBase: toNumber(base?.[metric]),
      valorComparado: toNumber(compared?.[metric]),
    }
  })
}

export function buildFinanceChartRows(
  rows: ComparativoFinanceiroMes[],
  anoBase: number,
  anoComparado: number,
  metric: FinanceMetricKey,
): ComparisonChartRow[] {
  const byYearMonth = new Map(rows.map((row) => [`${row.ano}-${row.mes}`, row]))

  return Array.from({ length: 12 }, (_, index) => {
    const mes = index + 1
    const base = byYearMonth.get(`${anoBase}-${mes}`)
    const compared = byYearMonth.get(`${anoComparado}-${mes}`)

    return {
      mes,
      label: COMPARATIVO_MONTH_LABELS[mes] ?? String(mes),
      valorBase: resolveFinanceMetricValue(base, metric),
      valorComparado: resolveFinanceMetricValue(compared, metric),
    }
  })
}

export function buildSupplierAnnualRows(
  rows: ComparativoFornecedorResumo[],
  anoBase: number,
  anoComparado: number,
): SupplierAnnualComparisonRow[] {
  const grouped = new Map<string, SupplierAnnualComparisonRow>()

  for (const row of rows) {
    const key = row.fornecedor_ref
    const current = grouped.get(key) ?? {
      fornecedorRef: row.fornecedor_ref,
      fornecedorCodigo: row.fornecedor_codigo,
      fornecedorNome: row.fornecedor_nome?.trim() || 'Sem fornecedor',
      ordensBase: 0,
      ordensComparado: 0,
      totalBase: 0,
      totalComparado: 0,
      realizadoBase: 0,
      realizadoComparado: 0,
      pendenteBase: 0,
      pendenteComparado: 0,
      deltaAbs: 0,
      deltaPct: 0,
    }

    if (row.ano === anoBase) {
      current.ordensBase = toNumber(row.total_ordens)
      current.totalBase = toNumber(row.total_gasto)
      current.realizadoBase = toNumber(row.valor_realizado)
      current.pendenteBase = toNumber(row.valor_previsto_pendente)
    }
    if (row.ano === anoComparado) {
      current.ordensComparado = toNumber(row.total_ordens)
      current.totalComparado = toNumber(row.total_gasto)
      current.realizadoComparado = toNumber(row.valor_realizado)
      current.pendenteComparado = toNumber(row.valor_previsto_pendente)
    }

    grouped.set(key, current)
  }

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      ...buildDelta(row.totalBase, row.totalComparado),
    }))
    .sort((left, right) => {
      if (right.totalComparado !== left.totalComparado) return right.totalComparado - left.totalComparado
      return left.fornecedorNome.localeCompare(right.fornecedorNome, 'pt-BR')
    })
}

export function buildSupplierMonthlyRows(
  rows: ComparativoFornecedorMes[],
  anoBase: number,
  anoComparado: number,
): SupplierMonthlyComparisonRow[] {
  const byYearMonth = new Map(rows.map((row) => [`${row.ano}-${row.mes}`, row]))

  const monthlyRows = Array.from({ length: 12 }, (_, index) => {
    const mes = index + 1
    const base = byYearMonth.get(`${anoBase}-${mes}`)
    const compared = byYearMonth.get(`${anoComparado}-${mes}`)

    const totalBase = toNumber(base?.total_gasto)
    const totalComparado = toNumber(compared?.total_gasto)

    return {
      key: `mes-${mes}`,
      label: COMPARATIVO_MONTH_LABELS[mes] ?? String(mes),
      mes,
      totalBase,
      totalComparado,
      realizadoBase: toNumber(base?.valor_realizado),
      realizadoComparado: toNumber(compared?.valor_realizado),
      pendenteBase: toNumber(base?.valor_previsto_pendente),
      pendenteComparado: toNumber(compared?.valor_previsto_pendente),
      ...buildDelta(totalBase, totalComparado),
    }
  })

  const totalBase = monthlyRows.reduce((sum, row) => sum + row.totalBase, 0)
  const totalComparado = monthlyRows.reduce((sum, row) => sum + row.totalComparado, 0)

  return [
    ...monthlyRows,
    {
      key: 'total',
      label: 'Total',
      mes: null,
      totalBase,
      totalComparado,
      realizadoBase: monthlyRows.reduce((sum, row) => sum + row.realizadoBase, 0),
      realizadoComparado: monthlyRows.reduce((sum, row) => sum + row.realizadoComparado, 0),
      pendenteBase: monthlyRows.reduce((sum, row) => sum + row.pendenteBase, 0),
      pendenteComparado: monthlyRows.reduce((sum, row) => sum + row.pendenteComparado, 0),
      ...buildDelta(totalBase, totalComparado),
    },
  ]
}

export function resolveSelectedSupplierRef(
  rows: SupplierAnnualComparisonRow[],
  requestedRef?: string | null,
): string | null {
  if (!rows.length) return null
  if (requestedRef && rows.some((row) => row.fornecedorRef === requestedRef)) return requestedRef
  return rows[0]?.fornecedorRef ?? null
}

export function sortSupplierAnnualRows(
  rows: SupplierAnnualComparisonRow[],
  key: SupplierSortKey,
  direction: SupplierSortDirection,
): SupplierAnnualComparisonRow[] {
  const sorted = [...rows].sort((left, right) => {
    if (key === 'nome') {
      return left.fornecedorNome.localeCompare(right.fornecedorNome, 'pt-BR')
    }

    const leftValue = key === 'total_base'
      ? left.totalBase
      : key === 'total_comparado'
        ? left.totalComparado
        : key === 'delta_abs'
          ? left.deltaAbs
          : left.deltaPct ?? Number.NEGATIVE_INFINITY

    const rightValue = key === 'total_base'
      ? right.totalBase
      : key === 'total_comparado'
        ? right.totalComparado
        : key === 'delta_abs'
          ? right.deltaAbs
          : right.deltaPct ?? Number.NEGATIVE_INFINITY

    if (leftValue !== rightValue) return leftValue - rightValue
    return left.fornecedorNome.localeCompare(right.fornecedorNome, 'pt-BR')
  })

  return direction === 'asc' ? sorted : sorted.reverse()
}

export function filterSupplierAnnualRows(
  rows: SupplierAnnualComparisonRow[],
  query: string,
): SupplierAnnualComparisonRow[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return rows

  return rows.filter((row) => {
    return row.fornecedorNome.toLowerCase().includes(normalized)
      || (row.fornecedorCodigo ?? '').toLowerCase().includes(normalized)
  })
}
