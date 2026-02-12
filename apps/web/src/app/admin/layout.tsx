import { redirect } from 'next/navigation'
import { AdminNav } from '@/components/admin/admin-nav'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/login')
  }

  const { data: admin } = await supabase
    .from('administradores')
    .select('role')
    .eq('email', user.email)
    .single()

  if (!admin || admin.role !== 'gestor') {
    redirect('/')
  }

  return (
    <div>
      <AdminNav />
      {children}
    </div>
  )
}
