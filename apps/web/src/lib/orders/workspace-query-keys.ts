import { buildWorkspaceParams, DEFAULT_ORDERS_WORKSPACE_LIMIT } from '@/lib/orders/workspace-query'
import type { OrdersWorkspaceFilters } from '@/lib/types/database'

const ORDERS_WORKSPACE_QUERY_NAMESPACE = 'orders-workspace'

export function buildOrdersWorkspaceScopeKey(filters: OrdersWorkspaceFilters): string {
  const params = buildWorkspaceParams(filters, null, DEFAULT_ORDERS_WORKSPACE_LIMIT)
  params.delete('limit')
  return params.toString()
}

export function createOrdersWorkspaceQueryKeys(filters: OrdersWorkspaceFilters) {
  const scopeKey = buildOrdersWorkspaceScopeKey(filters)

  return {
    scopeKey,
    main: [ORDERS_WORKSPACE_QUERY_NAMESPACE, 'main', scopeKey] as const,
    highlights: [ORDERS_WORKSPACE_QUERY_NAMESPACE, 'highlights', scopeKey] as const,
  }
}
