import { redirect } from 'next/navigation'
import { AdminNav } from '@/components/admin/admin-nav'
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
    <div className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col px-3 pb-8 pt-4 sm:px-4 lg:pl-6 lg:pr-4 xl:pl-6 xl:pr-6">
      <AdminDashboardRoutingBootstrap />
      <div className="flex flex-1 flex-col gap-3 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
        <AdminNav />
        <main className="min-w-0 w-full">{children}</main>
      </div>
    </div>
  )
}
