import {
  DEFAULT_ORDERS_WORKSPACE_LIMIT,
  buildWorkspaceParams,
  isRpcWithoutTipoOrdemSupport,
  parseOrdersWorkspaceRequest,
  toIsoEndExclusive,
  toIsoStart,
} from '@/lib/orders/workspace-query'
import type { OrdersWorkspaceFilters } from '@/lib/types/database'
import { describe, expect, it } from 'vitest'

const baseFilters: OrdersWorkspaceFilters = {
  periodMode: 'range',
  year: 2026,
  month: 3,
  startDate: '2026-03-01',
  endDate: '2026-03-03',
  q: '12345',
  status: 'em_avaliacao',
  responsavel: 'admin-1',
  unidade: 'CD MANAUS',
  prioridade: 'vermelho',
  tipoOrdem: 'PMPL',
}

describe('workspace-query', () => {
  it('serializes filters and cursor into URL params', () => {
    const params = buildWorkspaceParams(baseFilters, {
      ordem_detectada_em: '2026-03-03T10:00:00.000Z',
      ordem_id: '11111111-1111-4111-8111-111111111111',
    }, 150)

    expect(params.get('periodMode')).toBe('range')
    expect(params.get('startIso')).toBe('2026-03-01T00:00:00.000Z')
    expect(params.get('endExclusiveIso')).toBe('2026-03-04T00:00:00.000Z')
    expect(params.get('cursorOrdemId')).toBe('11111111-1111-4111-8111-111111111111')
    expect(params.get('limit')).toBe('150')
  })

  it('parses request params defensively and blocks PMPL without permission', () => {
    const searchParams = new URLSearchParams({
      periodMode: 'year_month',
      year: '2026',
      month: '3',
      startIso: '2026-03-01T00:00:00.000Z',
      endExclusiveIso: '2026-03-04T00:00:00.000Z',
      q: '  termo  ',
      status: 'EM_AVALIACAO',
      unidade: 'CD MANAUS',
      responsavel: 'admin-1',
      prioridade: 'VERMELHO',
      cursorDetectada: '2026-03-03T10:00:00.000Z',
      cursorOrdemId: '11111111-1111-4111-8111-111111111111',
      limit: '999',
      tipoOrdem: 'PMPL',
    })

    const parsed = parseOrdersWorkspaceRequest(searchParams, false)
    expect(parsed.periodMode).toBe('year_month')
    expect(parsed.q).toBe('termo')
    expect(parsed.status).toBe('em_avaliacao')
    expect(parsed.prioridade).toBe('vermelho')
    expect(parsed.limit).toBe(200)
    expect(parsed.tipoOrdem).toBe('PMOS')
  })

  it('falls back to defaults for invalid values', () => {
    const parsed = parseOrdersWorkspaceRequest(new URLSearchParams({
      periodMode: 'invalid',
      limit: '0',
      status: 'invalid',
      prioridade: 'invalid',
      tipoOrdem: 'todas',
      cursorOrdemId: 'invalid',
    }), true)

    expect(parsed.periodMode).toBe('all')
    expect(parsed.limit).toBe(DEFAULT_ORDERS_WORKSPACE_LIMIT)
    expect(parsed.status).toBeNull()
    expect(parsed.prioridade).toBeNull()
    expect(parsed.tipoOrdem).toBeNull()
    expect(parsed.cursorOrdemId).toBeNull()
  })

  it('recognizes tipoOrdem RPC compatibility failures', () => {
    expect(isRpcWithoutTipoOrdemSupport({ code: 'PGRST202' })).toBe(true)
    expect(isRpcWithoutTipoOrdemSupport({ hint: 'missing p_tipo_ordem parameter' })).toBe(true)
    expect(isRpcWithoutTipoOrdemSupport({ message: 'other failure' })).toBe(false)
    expect(isRpcWithoutTipoOrdemSupport(null)).toBe(false)
  })

  it('converts date boundaries consistently', () => {
    expect(toIsoStart('2026-03-01')).toBe('2026-03-01T00:00:00.000Z')
    expect(toIsoEndExclusive('2026-03-01')).toBe('2026-03-02T00:00:00.000Z')
    expect(toIsoStart(null)).toBeNull()
    expect(toIsoEndExclusive('invalid')).toBeNull()
  })
})
