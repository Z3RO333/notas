import { redirect } from 'next/navigation'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { PedidosPanel } from '@/components/pedidos/pedidos-panel'
import { canAccessPedidos } from '@/lib/pedidos/access'
import type { PedidoCompraStatusEfetivo, PedidosWorkspaceFilters } from '@/lib/types/pedidos'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const VALID_STATUS: readonly PedidoCompraStatusEfetivo[] = [
  'em_aberto',
  'encerrado',
  'cancelado',
  'indeterminado',
]

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function PedidosPage({ searchParams }: { searchParams: SearchParams }) {
  const currentAdminContext = await getCurrentAdminContext()

  if (!currentAdminContext.isAuthenticated || !currentAdminContext.email) {
    redirect('/login')
  }

  if (!currentAdminContext.adminId || !canAccessPedidos(currentAdminContext.role)) {
    redirect('/')
  }

  const params = await searchParams
  const rawStatus = firstParam(params.status)
  const rawYear = firstParam(params.ano)?.trim()
  const initialYear = rawYear && /^\d{4}$/.test(rawYear) && Number(rawYear) >= 2026
    ? rawYear
    : '2026'
  const initialFilters: PedidosWorkspaceFilters = {
    q: firstParam(params.q)?.trim() ?? '',
    status: VALID_STATUS.includes(rawStatus as PedidoCompraStatusEfetivo)
      ? rawStatus as PedidoCompraStatusEfetivo
      : 'all',
    adminId: currentAdminContext.isGestor ? firstParam(params.adminId)?.trim() || 'all' : 'all',
    anoExtracao: initialYear,
    mesExtracao: firstParam(params.mes)?.trim() || null,
  }

  const rawTab = firstParam(params.visao)
  const initialTab = rawTab === 'corretivas' || rawTab === 'preventivas_anuais'
    ? rawTab
    : 'pedidos'

  return (
    <PedidosPanel
      isGestor={currentAdminContext.isGestor}
      initialFilters={initialFilters}
      initialTab={initialTab}
    />
  )
}
