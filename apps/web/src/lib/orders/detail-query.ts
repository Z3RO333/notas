import type { QueryClient } from '@tanstack/react-query'
import type { OrderDetailDrawerData } from '@/lib/types/database'

export const ORDER_DETAIL_QUERY_NAMESPACE = 'order-detail'

export interface OrderDetailQueryParams {
  ordemId: string | null
  notaId: string | null
  lookupQuery?: string | null
  supplierLookupQuery?: string | null
}

export function createOrderDetailQueryKey(params: OrderDetailQueryParams) {
  return [
    ORDER_DETAIL_QUERY_NAMESPACE,
    params.ordemId ?? 'sem-ordem',
    params.notaId ?? 'sem-nota',
    params.lookupQuery?.trim() ?? '',
    params.supplierLookupQuery?.trim() ?? '',
  ] as const
}

export async function fetchOrderDetail(
  params: OrderDetailQueryParams,
  signal?: AbortSignal,
): Promise<OrderDetailDrawerData> {
  const safeOrdemId = params.ordemId?.trim() || null
  const safeNotaId = params.notaId?.trim() || null
  const safeLookupQuery = params.lookupQuery?.trim() || null
  const safeSupplierLookupQuery = params.supplierLookupQuery?.trim() || null

  if (!safeOrdemId && !safeNotaId) {
    throw new Error('ordemId ou notaId invalido')
  }

  const searchParams = new URLSearchParams()
  if (safeOrdemId) {
    searchParams.set('ordemId', safeOrdemId)
  } else if (safeNotaId) {
    searchParams.set('notaId', safeNotaId)
  }
  if (safeLookupQuery) {
    searchParams.set('lookupQ', safeLookupQuery)
  }
  if (safeSupplierLookupQuery) {
    searchParams.set('supplierQ', safeSupplierLookupQuery)
  }

  const response = await fetch(`/api/ordens/detalhe?${searchParams.toString()}`, {
    signal,
    cache: 'no-store',
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Falha ao carregar detalhes da ordem')
  }

  return response.json() as Promise<OrderDetailDrawerData>
}

export function prefetchOrderDetailQuery(
  queryClient: QueryClient,
  params: OrderDetailQueryParams,
) {
  if (!params.ordemId && !params.notaId) return Promise.resolve()

  return queryClient.prefetchQuery({
    queryKey: createOrderDetailQueryKey(params),
    queryFn: ({ signal }) => fetchOrderDetail(params, signal),
    staleTime: 60_000,
  })
}
