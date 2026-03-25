import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { createClient } from '@/lib/supabase/server'
import { AdminOperacionalSection } from '@/components/admin/dashboard/admin-operacional-section'
import { AdminOrdersSectionSkeleton } from '@/components/admin/dashboard/admin-orders-section-skeleton'
import {
  buildOperacionalYearOptions,
  resolveOperacionalDashboardPeriod,
  type OperacionalDashboardSearchParams,
} from '@/lib/dashboard/operacional-period'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { OperacionalFilter } from '@/components/admin/dashboard/operacional-filter'
import { readFirstParam } from '@/lib/grid/query'

export const dynamic = 'force-dynamic'

interface OperacionalPageProps {
  searchParams?: Promise<OperacionalDashboardSearchParams & { fornecedor?: string | string[] }>
}

export default async function OperacionalPage({ searchParams }: OperacionalPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveOperacionalDashboardPeriod(resolvedSearchParams)
  const fornecedorCodigo = readFirstParam(resolvedSearchParams?.fornecedor) ?? null
  const yearOptions = buildOperacionalYearOptions()

  if (!currentAdminContext.isAuthenticated) {
    redirect('/login')
  }

  if (!currentAdminContext.isGestor) {
    redirect('/')
  }

  const supabase = await createClient()
  const { data: operacionais } = await supabase
    .from('dim_operacionais')
    .select('codigo, nome')
    .eq('ativo', true)
    .order('nome')

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Operacional"
        subtitle="Produtividade e serviços dos colaboradores operacionais."
        rightSlot={
          <div className="flex items-center gap-3">
            <OperacionalFilter
              operacionais={operacionais ?? []}
              selectedFornecedor={fornecedorCodigo}
              selectedYear={period.year}
              selectedMonth={period.month}
              yearOptions={yearOptions}
            />
            <DashboardHeaderActions />
          </div>
        }
      />

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Operacional" />}>
        <AdminOperacionalSection period={period} fornecedorCodigo={fornecedorCodigo} />
      </Suspense>
    </div>
  )
}
