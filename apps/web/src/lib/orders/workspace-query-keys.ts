import { buildWorkspaceParams, DEFAULT_ORDERS_WORKSPACE_LIMIT } from '@/lib/orders/workspace-query'
import type { OrdersWorkspaceFilters } from '@/lib/types/database'

const ORDERS_WORKSPACE_QUERY_NAMESPACE = 'orders-workspace'

export function buildOrdersWorkspaceScopeKey(filters: OrdersWorkspaceFilters): string {
  const params = buildWorkspaceParams(filters, null, DEFAULT_ORDERS_WORKSPACE_LIMIT)
  params.delete('limit')
  return params.toString()
}

export function buildOrdersWorkspaceKpisScopeKey(filters: OrdersWorkspaceFilters): string {
  const params = buildWorkspaceParams(filters, null, DEFAULT_ORDERS_WORKSPACE_LIMIT)
  params.delete('limit')
  params.delete('q')
  params.delete('status')
  params.delete('responsavel')
  params.delete('unidade')
  params.delete('prioridade')
  return params.toString()
}

export function createOrdersWorkspaceQueryKeys(filters: OrdersWorkspaceFilters) {
  const scopeKey = buildOrdersWorkspaceScopeKey(filters)
  const kpisScopeKey = buildOrdersWorkspaceKpisScopeKey(filters)

  return {
    scopeKey,
    kpisScopeKey,
    main: [ORDERS_WORKSPACE_QUERY_NAMESPACE, 'main', scopeKey] as const,
    side: [ORDERS_WORKSPACE_QUERY_NAMESPACE, 'side', scopeKey] as const,
    kpis: [ORDERS_WORKSPACE_QUERY_NAMESPACE, 'kpis', kpisScopeKey] as const,
    highlights: [ORDERS_WORKSPACE_QUERY_NAMESPACE, 'highlights', scopeKey] as const,
  }
}
