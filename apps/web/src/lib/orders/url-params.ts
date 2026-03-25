import type { OrdersPeriodModeOperational, OrdersWorkspaceFilters } from '@/lib/types/database'

type RawSearchParams =
  | {
      periodMode?: string | string[]
      year?: string | string[]
      month?: string | string[]
      startDate?: string | string[]
      endDate?: string | string[]
      q?: string | string[]
      status?: string | string[]
      responsavel?: string | string[]
      unidade?: string | string[]
      prioridade?: string | string[]
      tipoOrdem?: string | string[]
    }
  | undefined

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

export function parseOptionalInt(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

export function parseDate(value: string | undefined): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

export function parsePeriodMode(value: string | undefined): OrdersPeriodModeOperational {
  if (value === 'year' || value === 'year_month' || value === 'month' || value === 'range') return value
  return 'all'
}

export function formatUtcYmd(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseInitialFilters(raw: RawSearchParams): OrdersWorkspaceFilters {
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const rawPeriodMode = firstParam(raw?.periodMode)
  const defaultStartDate = `${currentYear}-01-01`
  const defaultEndDate = formatUtcYmd(now)

  const periodMode = rawPeriodMode ? parsePeriodMode(rawPeriodMode) : 'range'
  const year = parseOptionalInt(firstParam(raw?.year)) ?? currentYear
  const month = parseOptionalInt(firstParam(raw?.month)) ?? currentMonth

  return {
    periodMode,
    year,
    month,
    startDate: parseDate(firstParam(raw?.startDate)) ?? (periodMode === 'range' ? defaultStartDate : null),
    endDate: parseDate(firstParam(raw?.endDate)) ?? (periodMode === 'range' ? defaultEndDate : null),
    q: (firstParam(raw?.q) ?? '').trim(),
    status: (firstParam(raw?.status) ?? 'ativas').trim() || 'ativas',
    responsavel: (firstParam(raw?.responsavel) ?? 'todos').trim() || 'todos',
    unidade: (firstParam(raw?.unidade) ?? '').trim(),
    prioridade: (firstParam(raw?.prioridade) ?? 'todas').trim() || 'todas',
    tipoOrdem: (firstParam(raw?.tipoOrdem) ?? 'PMOS').trim() || 'PMOS',
  }
}
