import { readFirstParam } from '@/lib/grid/query'

export type AdminPeriodPreset = '30d' | '90d' | '180d' | 'custom'

export interface AdminDashboardSearchParams {
  periodPreset?: string | string[]
  startDate?: string | string[]
  endDate?: string | string[]
  janela?: string | string[]
}

export interface AdminDashboardPeriod {
  preset: AdminPeriodPreset
  startDate: string
  endDate: string
  startIso: string
  endExclusiveIso: string
  spanDays: number
  periodLabel: string
  isCustom: boolean
}

const PRESET_DAYS: Record<Exclude<AdminPeriodPreset, 'custom'>, number> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
}

function parseDateInput(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const [yearRaw, monthRaw, dayRaw] = trimmed.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null
  }
  return trimmed
}

function formatYmd(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtcStartOfDay(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const start = toUtcStartOfDay(startYmd)
  const end = toUtcStartOfDay(endYmd)
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
}

function formatDateBr(ymd: string): string {
  const [year, month, day] = ymd.split('-')
  if (!year || !month || !day) return ymd
  return `${day}/${month}/${year}`
}

function toPresetFromLegacyWindow(janela: string | undefined): AdminPeriodPreset | null {
  if (janela === '90') return '90d'
  if (janela === '180') return '180d'
  if (janela === '30') return '30d'
  return null
}

function resolvePreset(
  rawPreset: string | undefined,
  rawLegacyWindow: string | undefined
): AdminPeriodPreset {
  if (rawPreset === '30d' || rawPreset === '90d' || rawPreset === '180d' || rawPreset === 'custom') {
    return rawPreset
  }
  const fromLegacy = toPresetFromLegacyWindow(rawLegacyWindow)
  return fromLegacy ?? '30d'
}

function buildFromPreset(
  preset: Exclude<AdminPeriodPreset, 'custom'>,
  now: Date
): AdminDashboardPeriod {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = addUtcDays(end, -(PRESET_DAYS[preset] - 1))
  const endExclusive = addUtcDays(end, 1)

  return {
    preset,
    startDate: formatYmd(start),
    endDate: formatYmd(end),
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    spanDays: PRESET_DAYS[preset],
    periodLabel: `Ultimos ${PRESET_DAYS[preset]} dias`,
    isCustom: false,
  }
}

function buildCustom(startDate: string, endDate: string): AdminDashboardPeriod {
  const start = toUtcStartOfDay(startDate)
  const end = toUtcStartOfDay(endDate)
  const endExclusive = addUtcDays(end, 1)

  return {
    preset: 'custom',
    startDate,
    endDate,
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    spanDays: diffDaysInclusive(startDate, endDate),
    periodLabel: `${formatDateBr(startDate)} a ${formatDateBr(endDate)}`,
    isCustom: true,
  }
}

export function resolveAdminDashboardPeriod(
  searchParams?: AdminDashboardSearchParams,
  now: Date = new Date()
): AdminDashboardPeriod {
  const rawPreset = readFirstParam(searchParams?.periodPreset)
  const rawStartDate = readFirstParam(searchParams?.startDate)
  const rawEndDate = readFirstParam(searchParams?.endDate)
  const rawLegacyWindow = readFirstParam(searchParams?.janela)

  const resolvedPreset = resolvePreset(rawPreset, rawLegacyWindow)

  if (resolvedPreset === 'custom') {
    const startDate = parseDateInput(rawStartDate)
    const endDate = parseDateInput(rawEndDate)
    if (startDate && endDate && startDate <= endDate) {
      return buildCustom(startDate, endDate)
    }
  }

  const fallbackPreset = resolvePreset(undefined, rawLegacyWindow)
  const safePreset = fallbackPreset === 'custom' ? '30d' : fallbackPreset
  return buildFromPreset(safePreset, now)
}
