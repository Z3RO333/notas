import { buildWorkspaceParams, MAX_ORDERS_WORKSPACE_LIMIT } from '@/lib/orders/workspace-query'
import type {
  OrdersWorkspaceCursor,
  OrdersWorkspaceFilters,
  OrdersWorkspaceResponse,
} from '@/lib/types/database'

interface WorkspaceFetchResponse {
  ok: boolean
  json: () => Promise<unknown>
}

type WorkspaceFetch = (
  input: string,
  init?: RequestInit,
) => Promise<WorkspaceFetchResponse>

export interface OrdersFilterCopyResult {
  codes: string[]
}

function extractCopyableCodes(payload: OrdersWorkspaceResponse): string[] {
  return payload.rows
    .map((row) => row.ordem_codigo?.trim() ?? '')
    .filter(Boolean)
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback

  const error = 'error' in payload ? payload.error : null
  if (typeof error !== 'string') return fallback

  const normalized = error.trim()
  return normalized.length > 0 ? normalized : fallback
}

export async function fetchAllFilteredOrderCodes(
  filters: OrdersWorkspaceFilters,
  options: {
    endpoint?: string
    fetchImpl?: WorkspaceFetch
    limit?: number
    signal?: AbortSignal
  } = {},
): Promise<OrdersFilterCopyResult> {
  const endpoint = options.endpoint ?? '/api/ordens/workspace'
  const fetchImpl = options.fetchImpl ?? fetch
  const limit = Math.min(
    Math.max(options.limit ?? MAX_ORDERS_WORKSPACE_LIMIT, 1),
    MAX_ORDERS_WORKSPACE_LIMIT,
  )

  const codes: string[] = []
  let cursor: OrdersWorkspaceCursor | null = null
  let pageCount = 0

  while (pageCount < 1000) {
    pageCount += 1

    const params = buildWorkspaceParams(filters, cursor, limit)
    const response = await fetchImpl(`${endpoint}?${params.toString()}`, {
      cache: 'no-store',
      signal: options.signal,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(resolveErrorMessage(payload, 'Falha ao carregar ordens para copiar'))
    }

    const payload = (await response.json()) as OrdersWorkspaceResponse
    codes.push(...extractCopyableCodes(payload))

    if (!payload.nextCursor || payload.rows.length === 0) {
      return { codes }
    }

    cursor = payload.nextCursor
  }

  throw new Error('Falha ao carregar ordens para copiar: paginação excedeu o limite esperado')
}
