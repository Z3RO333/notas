import { describe, expect, it } from 'vitest'
import type { GestaoBaseOrdem, TipoUnidade } from '@/lib/types/database'
import {
  buildPreventiveAnalysis,
  buildPreventiveRpcParams,
  resolvePreventivePeriod,
  type PreventivePeriod,
} from './preventive-analysis-utils'

const NOW = new Date('2026-03-26T12:00:00.000Z')

function makeRows(store: string, service: string, count: number, unitType: TipoUnidade = 'LOJA'): GestaoBaseOrdem[] {
  return Array.from({ length: count }, (_, index) => ({
    ordem_id: `${store}-${service}-${index}`,
    ordem_codigo: `52${String(index).padStart(5, '0')}`,
    tipo_ordem: 'PMOS',
    competencia_data: '2026-03-01',
    ano: 2026,
    mes: 3,
    nome_loja: store,
    tipo_unidade: unitType,
    texto_breve: service,
    status_ordem_raw: 'ABERTO',
    nota_referencia: `${index}`,
  }))
}

function makePeriod(): PreventivePeriod {
  return resolvePreventivePeriod({
    preventiva_periodo: 'ano',
    preventiva_ano: '2026',
  }, NOW)
}

describe('preventive-analysis-utils', () => {
  it('resolve trailing quarter periods and rpc params across years', () => {
    const period = resolvePreventivePeriod({
      preventiva_periodo: 'trimestre',
      preventiva_ano: '2026',
      preventiva_mes: '2',
    }, NOW)

    expect(period.months).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ])
    expect(period.startDate).toBe('2025-12-01')
    expect(period.endDate).toBe('2026-02-28')
    expect(period.periodLabel).toBe('Dez/2025 a Fev/2026')
    expect(buildPreventiveRpcParams(period, 'PMOS')).toEqual([
      { p_ano: 2025, p_mes: 12, p_tipo_ordem: 'PMOS' },
      { p_ano: 2026, p_mes: 1, p_tipo_ordem: 'PMOS' },
      { p_ano: 2026, p_mes: 2, p_tipo_ordem: 'PMOS' },
    ])
  })

  it('flags zero openings as critical risk for the selected store and service', () => {
    const rows = [
      ...makeRows('LOJA A', 'ELETRICA', 3),
      ...makeRows('LOJA B', 'ELETRICA', 2),
      ...makeRows('LOJA C', 'ELETRICA', 1),
      ...makeRows('LOJA B', 'PINTURA', 4),
      ...makeRows('LOJA C', 'PINTURA', 2),
    ]

    const analysis = buildPreventiveAnalysis(rows, makePeriod(), {
      preventiva_tipo_unidade: 'LOJA',
      preventiva_loja: 'LOJA A',
      preventiva_servico: 'PINTURA',
    })

    expect(analysis.store).toBe('LOJA A')
    expect(analysis.focusSummary.service).toBe('PINTURA')
    expect(analysis.focusSummary.selectedStoreCount).toBe(0)
    expect(analysis.focusSummary.selectedStoreRisk).toBe('critico')
    expect(analysis.totalStores).toBe(3)

    expect(analysis.storeRows.find((row) => row.service === 'PINTURA')).toMatchObject({
      count: 0,
      risk: 'critico',
    })

    expect(analysis.serviceRows[0]).toMatchObject({
      store: 'LOJA A',
      count: 0,
      risk: 'critico',
    })

    expect(analysis.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          store: 'LOJA A',
          service: 'PINTURA',
          count: 0,
          risk: 'critico',
        }),
      ]),
    )
  })

  it('auto-selects the most relevant service and marks low volume as attention', () => {
    const rows = [
      ...makeRows('LOJA A', 'ELETRICA', 1),
      ...makeRows('LOJA B', 'ELETRICA', 5),
      ...makeRows('LOJA C', 'ELETRICA', 4),
      ...makeRows('LOJA A', 'PINTURA', 1),
      ...makeRows('LOJA B', 'PINTURA', 1),
    ]

    const analysis = buildPreventiveAnalysis(rows, makePeriod(), {
      preventiva_tipo_unidade: 'LOJA',
      preventiva_loja: 'LOJA A',
    })

    expect(analysis.service).toBeNull()
    expect(analysis.focusSummary.service).toBe('ELETRICA')
    expect(analysis.focusSummary.autoSelected).toBe(true)
    expect(analysis.focusSummary.selectedStoreRisk).toBe('atencao')
    expect(analysis.storeRows[0]).toMatchObject({
      service: 'ELETRICA',
      count: 1,
      risk: 'atencao',
    })
  })

  it('ignores ineligible escalator service for Loja Matriz', () => {
    const rows = [
      ...makeRows('Loja Matriz', 'ELETRICA', 2),
      ...makeRows('Loja Amazonas Shopping', 'ELETRICA', 2),
      ...makeRows('Loja Amazonas Shopping', 'MANUT-PREVENTIVA ESCADA ROLANTE', 4),
      ...makeRows('Loja Shopping Ponta Negra', 'MANUT-PREVENTIVA ESCADA ROLANTE', 3),
    ]

    const analysis = buildPreventiveAnalysis(rows, makePeriod(), {
      preventiva_tipo_unidade: 'LOJA',
      preventiva_loja: 'Loja Matriz',
      preventiva_servico: 'MANUT-PREVENTIVA ESCADA ROLANTE',
    })

    expect(analysis.service).toBeNull()
    expect(analysis.focusSummary.service).toBe('ELETRICA')
    expect(analysis.storeRows.some((row) => row.service.includes('ESCADA ROLANTE'))).toBe(false)
    expect(
      analysis.alerts.some((alert) => alert.store === 'Loja Matriz' && alert.service.includes('ESCADA ROLANTE')),
    ).toBe(false)
    expect(analysis.options.services.some((service) => service.value.includes('ESCADA ROLANTE'))).toBe(false)
  })

  it('can switch the denominator to the official unit base for graficos KPIs', () => {
    const rows = [
      ...makeRows('LOJA A', 'ELETRICA', 4),
      ...makeRows('LOJA B', 'ELETRICA', 2),
    ]

    const analysis = buildPreventiveAnalysis(rows, makePeriod(), {
      preventiva_tipo_unidade: 'LOJA',
      preventiva_loja: 'LOJA A',
    }, {
      useOfficialUnitBase: true,
    })

    expect(analysis.totalStores).toBe(38)
    expect(analysis.metricCards[0]?.hint).toContain('38 unidades oficiais')
    expect(analysis.focusSummary.storesWithoutOrders).toBe(36)
  })
})
