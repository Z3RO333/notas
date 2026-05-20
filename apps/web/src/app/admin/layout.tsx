import { redirect } from 'next/navigation'
import { AdminDashboardRoutingBootstrap } from '@/components/admin/admin-dashboard-routing-bootstrap'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const currentAdminContext = await getCurrentAdminContext()

  if (!currentAdminContext.isAuthenticated) {
    redirect('/login')
  }

  if (!currentAdminContext.isGestor) {
    redirect('/')
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col pb-8">
      <AdminDashboardRoutingBootstrap />
      <main className="min-w-0 w-full">{children}</main>
    </div>
  )
}
