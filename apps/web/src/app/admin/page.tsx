import { redirect } from 'next/navigation'
import { AdminDashboardContent } from '@/components/admin/dashboard/admin-dashboard-content'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import {
  buildProductivityYearOptions,
  resolveAdminProductivityPeriod,
  type AdminProductivitySearchParams,
} from '@/lib/dashboard/productivity-month'
import { readFirstParam } from '@/lib/grid/query'

export const dynamic = 'force-dynamic'

interface AdminDashboardPageProps {
  searchParams?: Promise<AdminProductivitySearchParams & { especialidade?: string | string[] }>
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveAdminProductivityPeriod(resolvedSearchParams)
  const yearOptions = buildProductivityYearOptions()
  const especialidade = readFirstParam(resolvedSearchParams?.especialidade) ?? null

  if (!currentAdminContext.isAuthenticated) {
    redirect('/login')
  }

  if (!currentAdminContext.isGestor || !currentAdminContext.adminId) {
    redirect('/')
  }

  return (
    <AdminDashboardContent
      period={period}
      yearOptions={yearOptions}
      especialidade={especialidade}
    />
  )
}
