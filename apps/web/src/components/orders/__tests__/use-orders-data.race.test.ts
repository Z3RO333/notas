// Regression test — TanStack Query v5 já trata races via signal/keepPreviousData.
// Este teste documenta a expectativa pra pegar regressões futuras se a config de
// cache mudar.
/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures usam casts deliberados para shapes parciais */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'

import { useOrdersData } from '@/components/orders/use-orders-data'
import type { OrdersWorkspaceResponse } from '@/lib/types/database'

function makeResponse(scopeTag: string): OrdersWorkspaceResponse {
  return {
    rows: [{ ordem_id: `row-${scopeTag}` } as any],
    pendingSyncRows: [],
    kpis: {} as any,
    ownerSummary: [],
    poolGroups: [],
    nextCursor: null,
    reassignTargets: [],
    currentUser: { id: 'u', email: '', nome: '', canViewGlobal: true } as any,
    highlights: {} as any,
  } as unknown as OrdersWorkspaceResponse
}

function makeFilters(responsavel: string) {
  return {
    periodMode: 'todos',
    year: null,
    month: null,
    startDate: null,
    endDate: null,
    q: '',
    status: 'todas',
    responsavel,
    unidade: 'todas',
    prioridade: 'todas',
    tipoOrdem: 'todas',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('useOrdersData — troca rápida de filtros (regressão)', () => {
  let qc: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    qc.clear()
  })

  it('descarta resultado do fetch antigo quando filtro muda durante request em voo', async () => {
    fetchMock.mockImplementation((url: string) => {
      const urlStr = typeof url === 'string' ? url : String(url)
      const isFilterA = urlStr.includes('responsavel=admin-A')
      const delay = isFilterA ? 100 : 10
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: true,
              json: () => Promise.resolve(makeResponse(isFilterA ? 'A' : 'B')),
            }),
          delay,
        ),
      )
    })

    const onResetSuccess = vi.fn().mockResolvedValue(undefined)
    const initialUser = {
      role: 'admin',
      actualRole: 'admin',
      adminId: 'u',
      canViewGlobal: true,
      canAccessPmpl: true,
      userEmail: 'x@y',
      canUseDeveloperViewSwitcher: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const { result, rerender } = renderHook(
      ({ resp }: { resp: string }) =>
        useOrdersData({
          filters: makeFilters(resp),
          initialUser,
          onResetSuccess,
        }),
      { wrapper, initialProps: { resp: 'admin-A' } },
    )

    rerender({ resp: 'admin-B' })

    await waitFor(
      () => {
        expect(result.current.rows.map((r) => r.ordem_id)).toEqual(['row-B'])
      },
      { timeout: 1000 },
    )

    expect(result.current.rows.map((r) => r.ordem_id)).toEqual(['row-B'])
  })
})
