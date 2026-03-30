import { describe, expect, it } from 'vitest'
import {
  ALL_PRODUCTIVITY_MONTHS_PARAM,
  buildProductivityYearOptions,
  resolveAdminProductivityPeriod,
} from '@/lib/dashboard/productivity-month'

const NOW = new Date('2026-03-23T12:00:00.000Z')

describe('productivity-month', () => {
  it('defaults to the current month when params are absent', () => {
    const period = resolveAdminProductivityPeriod(undefined, NOW)

    expect(period.year).toBe(2026)
    expect(period.month).toBe(3)
    expect(period.startDate).toBe('2026-03-01')
    expect(period.endDate).toBe('2026-03-31')
    expect(period.label).toBe('Mar/2026')
    expect(period.previous.label).toBe('Fev/2026')
    expect(period.rollingMonths).toHaveLength(6)
    expect(period.rollingMonths[0]?.label).toBe('Out/2025')
    expect(period.rollingMonths[5]?.label).toBe('Mar/2026')
  })

  it('resolves a specific month when ano and mes are provided', () => {
    const period = resolveAdminProductivityPeriod({ ano: '2025', mes: '11' }, NOW)

    expect(period.year).toBe(2025)
    expect(period.month).toBe(11)
    expect(period.startIso).toBe('2025-11-01T00:00:00.000Z')
    expect(period.endExclusiveIso).toBe('2025-12-01T00:00:00.000Z')
    expect(period.previous.label).toBe('Out/2025')
  })

  it('resolves a full-year total when mes=all is provided', () => {
    const period = resolveAdminProductivityPeriod({ ano: '2025', mes: ALL_PRODUCTIVITY_MONTHS_PARAM }, NOW)

    expect(period.year).toBe(2025)
    expect(period.month).toBeNull()
    expect(period.startIso).toBe('2025-01-01T00:00:00.000Z')
    expect(period.endExclusiveIso).toBe('2026-01-01T00:00:00.000Z')
    expect(period.label).toBe('Ano 2025')
    expect(period.previous.label).toBe('Ano 2024')
    expect(period.rollingMonths).toHaveLength(12)
    expect(period.rollingMonths[0]?.label).toBe('Jan/2025')
    expect(period.rollingMonths[11]?.label).toBe('Dez/2025')
  })

  it('falls back safely when params are invalid', () => {
    const period = resolveAdminProductivityPeriod({ ano: 'abc', mes: '13' }, NOW)

    expect(period.year).toBe(2026)
    expect(period.month).toBe(3)
    expect(period.label).toBe('Mar/2026')
  })

  it('builds descending year options', () => {
    expect(buildProductivityYearOptions(NOW)).toEqual([2026, 2025, 2024, 2023, 2022, 2021])
  })
})
