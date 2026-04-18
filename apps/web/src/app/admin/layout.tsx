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
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <AdminDashboardRoutingBootstrap />
      <div className="flex flex-1 flex-col gap-2 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <AdminNav />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
