export interface RotaSourceOrder {
  ordemCodigo: string
  unidade: string | null
  createdAt: string
}

export interface RotaSourceSaida {
  id: string
  dataSaida: string
  ordens: RotaSourceOrder[]
}

export interface PublishRoutePayload {
  operational_id: string
  planned_date: string
  cockpit_cargo_id: string
  published_by_email: string
  stops: Array<{
    unit_name: string
    planned_sequence: number
    orders: Array<{ order_number: string }>
  }>
}

export interface ReassignRouteOrderPayload {
  idempotency_key: string
  order_number: string
  source_cockpit_cargo_id: string
  target_cockpit_cargo_id: string
  target_operational_id: string
  planned_date: string
  reason: string | null
  performed_by_email: string
}

export interface ReassignRouteOrderResponse {
  reassignment_id: string
  route_order_id: string
  order_number: string
  source_route_id: string
  target_route_id: string
  source_stop_id: string
  target_stop_id: string
  source_operational_id: string
  target_operational_id: string
  source_dispatch_id: string
  target_dispatch_id: string
  idempotency_key: string
  idempotent: boolean
}

function normalizeUnitName(value: string | null): string {
  const trimmed = value?.trim()
  return trimmed || 'SEM UNIDADE'
}

function formatManausDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Data de saída inválida')

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value

  return `${part('year')}-${part('month')}-${part('day')}`
}

export function buildPublishRoutePayload(
  saida: RotaSourceSaida,
  operationalId: string,
  publishedByEmail: string,
): PublishRoutePayload {
  const grouped = new Map<string, { unitName: string; orders: string[] }>()

  const sortedOrders = [...saida.ordens].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )

  for (const order of sortedOrders) {
    const orderNumber = order.ordemCodigo.trim()
    if (!orderNumber) continue

    const unitName = normalizeUnitName(order.unidade)
    const key = unitName.toLocaleUpperCase('pt-BR')
    const group = grouped.get(key) ?? { unitName, orders: [] }

    if (!group.orders.includes(orderNumber)) group.orders.push(orderNumber)
    grouped.set(key, group)
  }

  if (grouped.size === 0) throw new Error('A saída não possui ordens válidas')

  return {
    operational_id: operationalId,
    planned_date: formatManausDate(saida.dataSaida),
    cockpit_cargo_id: saida.id,
    published_by_email: publishedByEmail,
    stops: Array.from(grouped.values()).map((group, index) => ({
      unit_name: group.unitName,
      planned_sequence: index + 1,
      orders: group.orders.map((orderNumber) => ({ order_number: orderNumber })),
    })),
  }
}
