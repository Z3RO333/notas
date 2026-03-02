import { redirect } from 'next/navigation'
import { AdminNav } from '@/components/admin/admin-nav'
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
    <div>
      <AdminNav />
      {children}
    </div>
  )
}
