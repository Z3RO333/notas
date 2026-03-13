import { describe, expect, it } from 'vitest'
import { getSmartAgingCategory } from '@/lib/copilot/aging'

function notaWithDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return { data_criacao_sap: null, created_at: d.toISOString() }
}

describe('getSmartAgingCategory', () => {
  it('0 dias → dentro_prazo', () => expect(getSmartAgingCategory(notaWithDays(0))).toBe('dentro_prazo'))
  it('1 dia  → dentro_prazo', () => expect(getSmartAgingCategory(notaWithDays(1))).toBe('dentro_prazo'))
  it('2 dias → perto_de_estourar', () => expect(getSmartAgingCategory(notaWithDays(2))).toBe('perto_de_estourar'))
  it('3 dias → estourado', () => expect(getSmartAgingCategory(notaWithDays(3))).toBe('estourado'))
  it('4 dias → estourado', () => expect(getSmartAgingCategory(notaWithDays(4))).toBe('estourado'))
  it('5 dias → critico', () => expect(getSmartAgingCategory(notaWithDays(5))).toBe('critico'))
  it('9 dias → critico', () => expect(getSmartAgingCategory(notaWithDays(9))).toBe('critico'))
})
