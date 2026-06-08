import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import type {
  PedidoCompra,
  PedidosKpis,
  PedidosWorkspaceCursor,
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

function buildQueryParams(
  filters: PedidosWorkspaceFilters,
  cursor: PedidosWorkspaceCursor | null,
  includeMeta: boolean,
): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.adminId !== 'all') params.set('adminId', filters.adminId)
  params.set('ano', filters.anoExtracao ?? 'all')
  if (filters.mesExtracao) params.set('mes', filters.mesExtracao)
  if (filters.carteiraEspecial) params.set('carteiraEspecial', '1')
  if (cursor?.cursorDate) params.set('cursorDate', cursor.cursorDate)
  if (cursor?.cursorId) params.set('cursorId', cursor.cursorId)
  if (!includeMeta) params.set('includeMeta', '0')
  return params
}

interface UsePedidosDataOptions {
  filters: PedidosWorkspaceFilters
}

export function usePedidosData({ filters }: UsePedidosDataOptions) {
  const queryKey = ['pedidos-workspace', filters.q, filters.status, filters.adminId, filters.anoExtracao, filters.mesExtracao, filters.carteiraEspecial]

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as PedidosWorkspaceCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = buildQueryParams(filters, pageParam, pageParam === null)
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
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  const pages = query.data?.pages
  const firstPage = pages?.[0]
  const rows: PedidoCompra[] = pages ? pages.flatMap((page) => page.rows) : []
  const kpis: PedidosKpis = firstPage?.meta?.kpis ?? INITIAL_KPIS
  const availableAdmins = firstPage?.meta?.availableAdmins ?? []
  const availableAnos = firstPage?.meta?.availableAnos ?? []
  const availableMeses = firstPage?.meta?.availableMeses ?? []
  const loadingInitial = query.isPending && rows.length === 0
  const errorMessage = query.error instanceof Error ? query.error.message : query.error ? 'Falha ao carregar pedidos' : null

  return {
    rows,
    kpis,
    availableAdmins,
    availableAnos,
    availableMeses,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    loadingInitial,
    error: errorMessage,
  }
}
