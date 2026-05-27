import { redirect } from 'next/navigation'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { PedidosPanel } from '@/components/pedidos/pedidos-panel'

export const dynamic = 'force-dynamic'

export default async function PedidosPage() {
  const currentAdminContext = await getCurrentAdminContext()

  if (!currentAdminContext.isAuthenticated || !currentAdminContext.email) {
    redirect('/login')
  }

  if (!currentAdminContext.adminId || !currentAdminContext.role) {
    redirect('/login')
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock title="Pedidos de Compra" />
      <PedidosPanel />
    </div>
  )
}
