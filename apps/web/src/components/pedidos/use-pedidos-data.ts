import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type {
  PedidoCompra,
  PedidosKpis,
  PedidosWorkspaceFilters,
  PedidosWorkspaceResponse,
} from '@/lib/types/pedidos'

const INITIAL_KPIS: PedidosKpis = {
  total: 0,
  em_aberto: 0,
  encerrado: 0,
  cancelado: 0,
  valor_total: 0,
}

function buildQueryParams(filters: PedidosWorkspaceFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.adminId !== 'all') params.set('adminId', filters.adminId)
  params.set('ano', filters.anoExtracao ?? 'all')
  if (filters.mesExtracao) params.set('mesExtracao', filters.mesExtracao)
  return params
}

interface UsePedidosDataOptions {
  filters: PedidosWorkspaceFilters
}

export function usePedidosData({ filters }: UsePedidosDataOptions) {
  const queryKey = ['pedidos-workspace', filters.q, filters.status, filters.adminId, filters.anoExtracao, filters.mesExtracao]

  const { data, isFetching, isPlaceholderData, error } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const params = buildQueryParams(filters)
      const res = await fetch(`/api/pedidos/workspace?${params.toString()}`, {
        signal,
        cache: 'no-store',
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar pedidos')
      }
      return res.json() as Promise<PedidosWorkspaceResponse>
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  const rows: PedidoCompra[] = data?.rows ?? []
  const kpis: PedidosKpis = data?.kpis ?? INITIAL_KPIS
  const availableAdmins = data?.availableAdmins ?? []
  const availableAnos = data?.availableAnos ?? []
  const availableMeses = data?.availableMeses ?? []
  const loadingInitial = isFetching && !isPlaceholderData && rows.length === 0
  const errorMessage = error instanceof Error ? error.message : error ? 'Falha ao carregar pedidos' : null

  return {
    rows,
    kpis,
    availableAdmins,
    availableAnos,
    availableMeses,
    isFetching,
    loadingInitial,
    error: errorMessage,
  }
}
