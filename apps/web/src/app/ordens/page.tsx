import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { isMaintainerEmail } from '@/lib/auth/shared'
import { MVIEW_COOKIE_NAME, resolveMaintainerViewFromCookie } from '@/lib/auth/maintainer-view'
import { OrdersWorkspace } from '@/components/orders/orders-workspace'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { canAccessPmplTab, loadPmplCarteira } from '@/lib/orders/pmpl-routing'
import type { UserRole } from '@/lib/types/database'
import { parseInitialFilters } from '@/lib/orders/url-params'

export const dynamic = 'force-dynamic'

interface OrdersPageProps {
  searchParams?: Promise<{
    periodMode?: string | string[]
    year?: string | string[]
    month?: string | string[]
    startDate?: string | string[]
    endDate?: string | string[]
    q?: string | string[]
    status?: string | string[]
    responsavel?: string | string[]
    unidade?: string | string[]
    prioridade?: string | string[]
    tipoOrdem?: string | string[]
  }>
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const supabase = createAdminClient()
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const initialFilters = parseInitialFilters(resolvedSearchParams)

  if (!currentAdminContext.isAuthenticated || !currentAdminContext.email) {
    redirect('/login')
  }

  if (!currentAdminContext.adminId || !currentAdminContext.role) {
    redirect('/login')
  }

  const actualRole = currentAdminContext.role as UserRole
  const cookieStore = await cookies()
  const mviewCookie = cookieStore.get(MVIEW_COOKIE_NAME)?.value
  const secret = process.env.MAINTAINER_SESSION_SECRET
  const maintainerRole = resolveMaintainerViewFromCookie(mviewCookie, currentAdminContext.email, secret)
  const role = maintainerRole ?? actualRole
  const maintainerViewActive = maintainerRole !== null
  const canViewGlobal = role === 'gestor' || role === 'viewer'

  let canAccessPmpl = canViewGlobal
  if (!canViewGlobal) {
    try {
      const { adminIds: pmplAdminIds } = await loadPmplCarteira(supabase)
      canAccessPmpl = canAccessPmplTab({
        role,
        loggedAdminId: currentAdminContext.adminId,
        pmplAdminIds,
      })
    } catch {
      canAccessPmpl = false
    }
  }

  if (initialFilters.tipoOrdem === 'PMPL' && !canAccessPmpl) {
    initialFilters.tipoOrdem = 'PMOS'
  }

  const latestSyncResult = await supabase
    .from('sync_log')
    .select('finished_at, status')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  const initialUser = {
    role,
    actualRole,
    adminId: currentAdminContext.adminId,
    canViewGlobal,
    canAccessPmpl,
    maintainerViewActive,
    userEmail: currentAdminContext.email,
    canUseDeveloperViewSwitcher: isMaintainerEmail(currentAdminContext.email),
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Ordens"
        rightSlot={<LastSyncBadge timestamp={latestSyncResult.data?.finished_at ?? null} status={latestSyncResult.data?.status ?? null} />}
      />

      <OrdersWorkspace
        key={`${initialUser.adminId}:${initialUser.role}`}
        initialFilters={initialFilters}
        initialUser={initialUser}
      />
      <RealtimeListener />
    </div>
  )
}
