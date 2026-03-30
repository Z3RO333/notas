import { readFirstParam } from '@/lib/grid/query'

export interface AdminProductivitySearchParams {
  ano?: string | string[]
  mes?: string | string[]
}

export interface ProductivityMonthWindow {
  year: number
  month: number | null
  startDate: string
  endDate: string
  startIso: string
  endExclusiveIso: string
  label: string
}

export interface AdminProductivityPeriod extends ProductivityMonthWindow {
  previous: ProductivityMonthWindow
  rollingMonths: ProductivityMonthWindow[]
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const ALL_PRODUCTIVITY_MONTHS_PARAM = 'all'

function formatYmd(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toWindow(year: number, month: number | null): ProductivityMonthWindow {
  const start = month === null
    ? new Date(Date.UTC(year, 0, 1))
    : new Date(Date.UTC(year, month - 1, 1))
  const endExclusive = month === null
    ? new Date(Date.UTC(year + 1, 0, 1))
    : new Date(Date.UTC(year, month, 1))
  const end = new Date(endExclusive)
  end.setUTCDate(end.getUTCDate() - 1)

  return {
    year,
    month,
    startDate: formatYmd(start),
    endDate: formatYmd(end),
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    label: month === null ? `Ano ${year}` : `${MONTH_SHORT[month - 1]}/${year}`,
  }
}

function addUtcMonths(value: Date, months: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1))
}

function parseYear(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 2000 || parsed > 2100) return null
  return parsed
}

function parseMonth(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined
  if (value === ALL_PRODUCTIVITY_MONTHS_PARAM) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return undefined
  if (parsed < 1 || parsed > 12) return undefined
  return parsed
}

export function buildProductivityYearOptions(now: Date = new Date(), totalYears = 6): number[] {
  const currentYear = now.getUTCFullYear()
  const years: number[] = []

  for (let offset = 0; offset < totalYears; offset += 1) {
    years.push(currentYear - offset)
  }

  return years
}

export function resolveAdminProductivityPeriod(
  searchParams?: AdminProductivitySearchParams,
  now: Date = new Date(),
): AdminProductivityPeriod {
  const rawYear = readFirstParam(searchParams?.ano)
  const rawMonth = readFirstParam(searchParams?.mes)
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1

  const parsedYear = parseYear(rawYear)
  const parsedMonth = parseMonth(rawMonth)
  const invalidYearProvided = rawYear !== undefined && parsedYear === null
  const invalidMonthProvided = rawMonth !== undefined && parsedMonth === undefined

  const year = (invalidYearProvided || invalidMonthProvided)
    ? currentYear
    : (parsedYear ?? currentYear)
  const month = (invalidYearProvided || invalidMonthProvided)
    ? currentMonth
    : (parsedMonth === undefined ? currentMonth : parsedMonth)
  const current = toWindow(year, month)

  const previous = month === null
    ? toWindow(year - 1, null)
    : (() => {
      const previousAnchor = addUtcMonths(new Date(Date.UTC(year, month - 1, 1)), -1)
      return toWindow(previousAnchor.getUTCFullYear(), previousAnchor.getUTCMonth() + 1)
    })()

  const rollingMonths = month === null
    ? Array.from({ length: 12 }, (_, index) => toWindow(year, index + 1))
    : Array.from({ length: 6 }, (_, index) => {
      const anchor = addUtcMonths(new Date(Date.UTC(year, month - 1, 1)), index - 5)
      return toWindow(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1)
    })

  return {
    ...current,
    previous,
    rollingMonths,
  }
}
