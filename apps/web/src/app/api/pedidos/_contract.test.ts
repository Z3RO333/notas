import { describe, expect, it } from 'vitest'
import {
  buildPedidosContractMeta,
  mapPedidosKpis,
  normalizePedidoStatusEfetivo,
} from '@/app/api/pedidos/_contract'

describe('pedidos API contract', () => {
  it('maps the canonical KPI extensions and preserves legacy keys', () => {
    expect(mapPedidosKpis({
      total: '12',
      em_aberto: 2,
      encerrado: 8,
      cancelado: 1,
      status_indeterminado: 1,
      valor_total: '1500.25',
      valor_em_aberto: '75.50',
      valor_itens_ativos: 70,
      sem_responsavel: 3,
      legado_nao_validado: 4,
      ultima_atualizacao: '2026-08-14T12:00:00Z',
    })).toMatchObject({
      total: 12,
      em_aberto: 2,
      encerrado: 8,
      cancelado: 1,
      indeterminado: 1,
      status_indeterminado: 1,
      valor_total: 1500.25,
      valor_em_aberto: 75.5,
      valor_itens_ativos: 70,
      sem_responsavel: 3,
      legado_nao_validado: 4,
      ultima_atualizacao: '2026-08-14T12:00:00Z',
    })
  })

  it('returns safe metadata defaults while keeping the canonical scope explicit', () => {
    expect(buildPedidosContractMeta(null)).toEqual({
      scope: {
        grupoCompradores: '112',
        periodField: 'data_documento',
        attributionMode: 'responsavel_atual',
      },
      freshness: {
        asOf: null,
        syncedAt: null,
        stale: null,
      },
      quality: {
        indeterminados: 0,
        semItens: 0,
        semCriadorMapeado: 0,
        semResponsavel: 0,
        statusDesconhecido: 0,
        legadoNaoValidado: 0,
      },
    })
  })

  it('does not silently classify an unknown effective status as open', () => {
    expect(normalizePedidoStatusEfetivo('novo_codigo_sap')).toBe('indeterminado')
  })
})
