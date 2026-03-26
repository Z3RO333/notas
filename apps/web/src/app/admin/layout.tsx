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
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <AdminNav />
      <main className="flex-1">{children}</main>
    </div>
  )
}
