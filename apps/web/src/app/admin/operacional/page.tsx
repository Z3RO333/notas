import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AdminOperacionalSection } from '@/components/admin/dashboard/admin-operacional-section'
import { AdminOrdersSectionSkeleton } from '@/components/admin/dashboard/admin-orders-section-skeleton'
import { OperacionalFilter } from '@/components/admin/dashboard/operacional-filter'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import {
  buildOperacionalYearOptions,
  resolveOperacionalDashboardPeriod,
  type OperacionalDashboardSearchParams,
} from '@/lib/dashboard/operacional-period'
import { readFirstParam } from '@/lib/grid/query'
import { createClient } from '@/lib/supabase/server'

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
      <div className="rounded-2xl border bg-card/60 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Filtros do painel
            </p>
            <p className="text-sm text-muted-foreground">
              Ajuste colaborador e periodo sem ocupar a area principal da leitura.
            </p>
          </div>

          <div className="flex flex-col gap-3 xl:items-end">
            <OperacionalFilter
              operacionais={operacionais ?? []}
              selectedFornecedor={fornecedorCodigo}
              selectedYear={period.year}
              selectedMonth={period.month}
              yearOptions={yearOptions}
            />
            <DashboardHeaderActions />
          </div>
        </div>
      </div>

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Operacional" />}>
        <AdminOperacionalSection period={period} fornecedorCodigo={fornecedorCodigo} />
      </Suspense>
    </div>
  )
}
