import { redirect } from 'next/navigation'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { AdminProductivityFilter } from '@/components/admin/dashboard/admin-productivity-filter'
import { AdminProductivityPanel } from '@/components/admin/dashboard/admin-productivity-panel'
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Painel estratégico de produtividade mensal, com foco total no desempenho de operacionais e administradores no mês selecionado.
          </p>
        </div>

        <AdminProductivityFilter
          selectedYear={period.year}
          selectedMonth={period.month}
          yearOptions={yearOptions}
        />
      </div>

      <AdminProductivityPanel period={period} />
    </div>
  )
}
