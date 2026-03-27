import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AdminProductivityFilter } from '@/components/admin/dashboard/admin-productivity-filter'
import { AdminOrdersSectionSkeleton } from '@/components/admin/dashboard/admin-orders-section-skeleton'
import { AdminProductivityPanel } from '@/components/admin/dashboard/admin-productivity-panel'
import { PageTitleBlock } from '@/components/shared/page-title-block'
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
    <div className="space-y-6">
      <PageTitleBlock title="Produtividade Mensal" />

      <AdminProductivityFilter
        selectedYear={period.year}
        selectedMonth={period.month}
        yearOptions={yearOptions}
        selectedEspecialidade={especialidade}
      />

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Produtividade" includeRanking />}>
        <AdminProductivityPanel period={period} especialidade={especialidade} />
      </Suspense>
    </div>
  )
}
