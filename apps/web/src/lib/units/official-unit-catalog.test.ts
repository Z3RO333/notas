import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_REFERENCE_TOTALS,
  getOfficialGestaoUniverseCount,
  getOfficialUnitAudit,
  getOfficialUnitEntries,
} from './official-unit-catalog'

describe('official-unit-catalog', () => {
  it('matches the official workbook totals for primary categories', () => {
    expect(OFFICIAL_REFERENCE_TOTALS.LOJA).toBe(38)
    expect(OFFICIAL_REFERENCE_TOTALS.FARMA).toBe(45)
    expect(OFFICIAL_REFERENCE_TOTALS.CD).toBe(5)
    expect(OFFICIAL_REFERENCE_TOTALS.MERCADO).toBe(4)
    expect(OFFICIAL_REFERENCE_TOTALS.LOTERIA).toBe(22)
    expect(OFFICIAL_REFERENCE_TOTALS.SUPORTE).toBe(12)
  })

  it('exposes the same operational universe used by the graficos panel', () => {
    expect(getOfficialGestaoUniverseCount('LOJA')).toBe(38)
    expect(getOfficialGestaoUniverseCount('FARMA')).toBe(45)
    expect(getOfficialGestaoUniverseCount('CD')).toBe(5)
    expect(getOfficialGestaoUniverseCount('todos')).toBe(88)
  })

  it('keeps the audit groups needed to explain historical inflation', () => {
    const audit = getOfficialUnitAudit()

    expect(audit.legacyInflation.LOJA.map((entry) => entry.centro)).toEqual([
      '100',
      '102',
      '122',
      '123',
      '145',
      '151',
      '801',
      '850',
    ])
    expect(audit.legacyInflation.FARMA.map((entry) => entry.centro)).toEqual([
      '600',
      '606',
      '628',
      '696',
      '699',
    ])
    expect(audit.legacyInflation.CD.map((entry) => entry.centro)).toEqual([
      '144',
      '149',
      '170',
    ])
    expect(audit.supplementalEntries.map((entry) => entry.centro)).toEqual(['207', '616'])
    expect(getOfficialUnitEntries('SUPORTE')).toHaveLength(12)
  })
})
