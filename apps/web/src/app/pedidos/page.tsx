import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { MVIEW_COOKIE_NAME, resolveMaintainerViewFromCookie } from '@/lib/auth/maintainer-view'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { PedidosPanel } from '@/components/pedidos/pedidos-panel'
import type { UserRole } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

export default async function PedidosPage() {
  const currentAdminContext = await getCurrentAdminContext()

  if (!currentAdminContext.isAuthenticated || !currentAdminContext.email) {
    redirect('/login')
  }

  if (!currentAdminContext.adminId || !currentAdminContext.role) {
    redirect('/login')
  }

  const actualRole = currentAdminContext.role as UserRole
  const cookieStore = await cookies()
  const mviewCookie = cookieStore.get(MVIEW_COOKIE_NAME)?.value
  const secret = process.env.MAINTAINER_SESSION_SECRET
  const role = resolveMaintainerViewFromCookie(mviewCookie, currentAdminContext.email, secret) ?? actualRole
  const canViewGlobal = role === 'gestor' || role === 'viewer'

  const initialUser = {
    role,
    adminId: currentAdminContext.adminId,
    canViewGlobal,
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock title="Pedidos de Compra" />
      <PedidosPanel
        key={`${initialUser.adminId}:${initialUser.role}`}
        initialUser={initialUser}
      />
    </div>
  )
}
