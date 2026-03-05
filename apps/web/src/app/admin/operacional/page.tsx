import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { createClient } from '@/lib/supabase/server'
import { AdminOperacionalSection } from '@/components/admin/dashboard/admin-operacional-section'
import { AdminOrdersSectionSkeleton } from '@/components/admin/dashboard/admin-orders-section-skeleton'
import { resolveAdminDashboardPeriod, type AdminDashboardSearchParams } from '@/lib/dashboard/period'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
import { OperacionalFilter } from '@/components/admin/dashboard/operacional-filter'
import { readFirstParam } from '@/lib/grid/query'

export const dynamic = 'force-dynamic'

interface OperacionalPageProps {
  searchParams?: Promise<AdminDashboardSearchParams & { fornecedor?: string | string[] }>
}

export default async function OperacionalPage({ searchParams }: OperacionalPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveAdminDashboardPeriod(resolvedSearchParams)
  const fornecedorCodigo = readFirstParam(resolvedSearchParams?.fornecedor) ?? null

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operacional</h1>
          <p className="text-sm text-muted-foreground">
            Produtividade e serviços dos colaboradores operacionais.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <OperacionalFilter
            operacionais={operacionais ?? []}
            selected={fornecedorCodigo}
          />
          <DashboardHeaderActions />
        </div>
      </div>

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Operacional" />}>
        <AdminOperacionalSection period={period} fornecedorCodigo={fornecedorCodigo} />
      </Suspense>
    </div>
  )
}
