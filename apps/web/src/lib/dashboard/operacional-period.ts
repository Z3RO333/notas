import { readFirstParam } from '@/lib/grid/query'

export interface OperacionalDashboardSearchParams {
  ano?: string | string[]
  mes?: string | string[]
}

export interface OperacionalDashboardPeriod {
  year: number
  month: number | null
  startDate: string
  endDate: string
  startIso: string
  endExclusiveIso: string
  periodLabel: string
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function formatYmd(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseYearInput(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 2000 || parsed > 2100) return null
  return parsed
}

function parseMonthInput(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 1 || parsed > 12) return null
  return parsed
}

export function buildOperacionalYearOptions(now: Date = new Date(), totalYears: number = 6): number[] {
  const currentYear = now.getUTCFullYear()
  const years: number[] = []
  for (let offset = 0; offset < totalYears; offset += 1) {
    years.push(currentYear - offset)
  }
  return years
}

export function resolveOperacionalDashboardPeriod(
  searchParams?: OperacionalDashboardSearchParams,
  now: Date = new Date()
): OperacionalDashboardPeriod {
  const currentYear = now.getUTCFullYear()

  const rawYear = readFirstParam(searchParams?.ano)
  const rawMonth = readFirstParam(searchParams?.mes)
  const parsedYear = parseYearInput(rawYear)
  const parsedMonth = parseMonthInput(rawMonth)

  const invalidYearProvided = rawYear !== undefined && parsedYear === null
  const invalidMonthProvided = rawMonth !== undefined && parsedMonth === null

  const year = (invalidYearProvided || invalidMonthProvided)
    ? currentYear
    : (parsedYear ?? currentYear)
  const month = (invalidYearProvided || invalidMonthProvided)
    ? null
    : (parsedMonth ?? null)

  const start = month === null
    ? new Date(Date.UTC(year, 0, 1))
    : new Date(Date.UTC(year, month - 1, 1))
  const endExclusive = month === null
    ? new Date(Date.UTC(year + 1, 0, 1))
    : new Date(Date.UTC(year, month, 1))
  const end = new Date(endExclusive)
  end.setUTCDate(end.getUTCDate() - 1)

  const periodLabel = month === null
    ? `Ano ${year}`
    : `${MONTH_SHORT[month - 1]}/${year}`

  return {
    year,
    month,
    startDate: formatYmd(start),
    endDate: formatYmd(end),
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    periodLabel,
  }
}
