import { createOrdersWorkspaceQueryKeys } from '@/lib/orders/workspace-query-keys'
import type { OrdersWorkspaceFilters } from '@/lib/types/database'

const baseFilters: OrdersWorkspaceFilters = {
  periodMode: 'range',
  year: 2026,
  month: 4,
  startDate: '2026-01-01',
  endDate: '2026-04-17',
  q: '  12345678  ',
  status: 'ativas',
  responsavel: 'todos',
  unidade: '',
  prioridade: 'todas',
  tipoOrdem: 'PMOS',
}

describe('createOrdersWorkspaceQueryKeys', () => {
  it('builds a stable scope key from filter values', () => {
    const keys = createOrdersWorkspaceQueryKeys(baseFilters)

    expect(keys.scopeKey).toBe(
      'periodMode=range&year=2026&month=4&startIso=2026-01-01T00%3A00%3A00.000Z&endExclusiveIso=2026-04-18T00%3A00%3A00.000Z&q=++12345678++&status=ativas&tipoOrdem=PMOS',
    )
    expect(keys.kpisScopeKey).toBe(
      'periodMode=range&year=2026&month=4&startIso=2026-01-01T00%3A00%3A00.000Z&endExclusiveIso=2026-04-18T00%3A00%3A00.000Z&tipoOrdem=PMOS',
    )
    expect(keys.main).toEqual(['orders-workspace', 'main', keys.scopeKey])
    expect(keys.side).toEqual(['orders-workspace', 'side', keys.scopeKey])
    expect(keys.kpis).toEqual(['orders-workspace', 'kpis', keys.kpisScopeKey])
    expect(keys.highlights).toEqual(['orders-workspace', 'highlights', keys.scopeKey])
  })

  it('returns the same scope key for equivalent filter objects', () => {
    const reorderedFilters = {
      tipoOrdem: 'PMOS',
      prioridade: 'todas',
      unidade: '',
      responsavel: 'todos',
      status: 'ativas',
      q: '  12345678  ',
      endDate: '2026-04-17',
      startDate: '2026-01-01',
      month: 4,
      year: 2026,
      periodMode: 'range',
    } satisfies OrdersWorkspaceFilters

    const baseKeys = createOrdersWorkspaceQueryKeys(baseFilters)
    const reorderedKeys = createOrdersWorkspaceQueryKeys(reorderedFilters)

    expect(reorderedKeys.scopeKey).toBe(baseKeys.scopeKey)
  })
})
