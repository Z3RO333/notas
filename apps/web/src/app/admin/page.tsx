import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { AdminDashboardRoutingBootstrap } from '@/components/admin/admin-dashboard-routing-bootstrap'
import { AdminNotesSection } from '@/components/admin/dashboard/admin-notes-section'
import { AdminNotesSectionSkeleton } from '@/components/admin/dashboard/admin-notes-section-skeleton'
import { AdminOrdersSectionSkeleton } from '@/components/admin/dashboard/admin-orders-section-skeleton'
import { AdminPmosSection } from '@/components/admin/dashboard/admin-pmos-section'
import { AdminPmplSection } from '@/components/admin/dashboard/admin-pmpl-section'
import { DistributeButton } from '@/components/dashboard/distribute-button'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { resolveAdminDashboardPeriod, type AdminDashboardSearchParams } from '@/lib/dashboard/period'
import type { OrderReassignTarget } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

interface AdminDashboardPageProps {
  searchParams?: Promise<AdminDashboardSearchParams>
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveAdminDashboardPeriod(resolvedSearchParams)

  if (!currentAdminContext.isAuthenticated) {
    redirect('/login')
  }

  if (!currentAdminContext.isGestor || !currentAdminContext.adminId) {
    redirect('/')
  }

  const supabase = await createClient()
  const reassignTargetsResult = await supabase
    .from('administradores')
    .select('id, nome')
    .eq('role', 'admin')
    .eq('ativo', true)
    .eq('em_ferias', false)
    .order('nome')

  if (reassignTargetsResult.error) {
    throw reassignTargetsResult.error
  }

  const reassignTargets = (reassignTargetsResult.data ?? []) as OrderReassignTarget[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
        </div>
        <div className="flex items-center gap-2">
          <DashboardHeaderActions />
          <DistributeButton />
        </div>
      </div>

      <AdminDashboardRoutingBootstrap />

      <Suspense fallback={<AdminNotesSectionSkeleton />}>
        <AdminNotesSection period={period} />
      </Suspense>

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Acompanhamento PMOS" includeRanking />}>
        <AdminPmosSection period={period} reassignTargets={reassignTargets} />
      </Suspense>

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Acompanhamento PMPL" />}>
        <AdminPmplSection period={period} reassignTargets={reassignTargets} />
      </Suspense>

      <RealtimeListener />
    </div>
  )
}
