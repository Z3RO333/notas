import { redirect } from 'next/navigation'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { AdminProductivityFilter } from '@/components/admin/dashboard/admin-productivity-filter'
import { AdminProductivityPanel } from '@/components/admin/dashboard/admin-productivity-panel'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import {
  buildProductivityYearOptions,
  resolveAdminProductivityPeriod,
  type AdminProductivitySearchParams,
} from '@/lib/dashboard/productivity-month'

export const dynamic = 'force-dynamic'

interface AdminDashboardPageProps {
  searchParams?: Promise<AdminProductivitySearchParams>
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveAdminProductivityPeriod(resolvedSearchParams)
  const yearOptions = buildProductivityYearOptions()

  if (!currentAdminContext.isAuthenticated) {
    redirect('/login')
  }

  if (!currentAdminContext.isGestor || !currentAdminContext.adminId) {
    redirect('/')
  }

  return (
    <div className="space-y-8">
      <PageTitleBlock
        title="Produtividade Mensal"
        subtitle="Painel estratégico de produtividade mensal, com foco total no desempenho de operacionais e administradores no mês selecionado."
        rightSlot={
          <AdminProductivityFilter
            selectedYear={period.year}
            selectedMonth={period.month}
            yearOptions={yearOptions}
          />
        }
      />

      <AdminProductivityPanel period={period} />
    </div>
  )
}
