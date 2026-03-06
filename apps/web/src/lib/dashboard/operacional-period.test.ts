import { describe, expect, it } from 'vitest'
import {
  buildOperacionalYearOptions,
  resolveOperacionalDashboardPeriod,
} from '@/lib/dashboard/operacional-period'

const NOW = new Date('2026-03-06T12:00:00.000Z')

describe('operacional-period', () => {
  it('uses current year when no params are provided', () => {
    const period = resolveOperacionalDashboardPeriod(undefined, NOW)

    expect(period.year).toBe(2026)
    expect(period.month).toBeNull()
    expect(period.startDate).toBe('2026-01-01')
    expect(period.endDate).toBe('2026-12-31')
    expect(period.startIso).toBe('2026-01-01T00:00:00.000Z')
    expect(period.endExclusiveIso).toBe('2027-01-01T00:00:00.000Z')
    expect(period.periodLabel).toBe('Ano 2026')
  })

  it('resolves full year when only ano is provided', () => {
    const period = resolveOperacionalDashboardPeriod({ ano: '2025' }, NOW)

    expect(period.year).toBe(2025)
    expect(period.month).toBeNull()
    expect(period.startDate).toBe('2025-01-01')
    expect(period.endDate).toBe('2025-12-31')
    expect(period.periodLabel).toBe('Ano 2025')
  })

  it('resolves specific month when ano and mes are provided', () => {
    const period = resolveOperacionalDashboardPeriod({ ano: '2025', mes: '3' }, NOW)

    expect(period.year).toBe(2025)
    expect(period.month).toBe(3)
    expect(period.startDate).toBe('2025-03-01')
    expect(period.endDate).toBe('2025-03-31')
    expect(period.startIso).toBe('2025-03-01T00:00:00.000Z')
    expect(period.endExclusiveIso).toBe('2025-04-01T00:00:00.000Z')
    expect(period.periodLabel).toBe('Mar/2025')
  })

  it('uses current year when only mes is provided', () => {
    const period = resolveOperacionalDashboardPeriod({ mes: '3' }, NOW)

    expect(period.year).toBe(2026)
    expect(period.month).toBe(3)
    expect(period.startDate).toBe('2026-03-01')
    expect(period.endDate).toBe('2026-03-31')
  })

  it('falls back safely when ano is invalid', () => {
    const period = resolveOperacionalDashboardPeriod({ ano: 'abc', mes: '3' }, NOW)

    expect(period.year).toBe(2026)
    expect(period.month).toBeNull()
    expect(period.startDate).toBe('2026-01-01')
    expect(period.endDate).toBe('2026-12-31')
  })

  it('falls back safely when mes is invalid', () => {
    const period = resolveOperacionalDashboardPeriod({ ano: '2025', mes: '13' }, NOW)

    expect(period.year).toBe(2026)
    expect(period.month).toBeNull()
    expect(period.startDate).toBe('2026-01-01')
    expect(period.endDate).toBe('2026-12-31')
  })

  it('builds a descending year list with the last 6 years by default', () => {
    expect(buildOperacionalYearOptions(NOW)).toEqual([2026, 2025, 2024, 2023, 2022, 2021])
  })
})
