import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { resolveMaintainerViewFromCookie } from '@/lib/auth/shared'
import { MVIEW_COOKIE_NAME } from '@/lib/auth/maintainer-view'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { PedidosWorkspace } from '@/components/pedidos/pedidos-workspace'
import type { UserRole } from '@/lib/types/database'
import type { PedidoCompraStatus, PedidosWorkspaceFilters } from '@/lib/types/pedidos'

export const dynamic = 'force-dynamic'

interface PedidosPageProps {
  searchParams?: Promise<{
    q?: string | string[]
    status?: string | string[]
    adminId?: string | string[]
    mes?: string | string[]
  }>
}

function parseParam(value: string | string[] | undefined): string {
  if (!value) return ''
  return Array.isArray(value) ? (value[0] ?? '') : value
}

function parseInitialFilters(params: Awaited<PedidosPageProps['searchParams']>): PedidosWorkspaceFilters {
  const rawStatus = parseParam(params?.status)
  const validStatuses: PedidoCompraStatus[] = ['em_aberto', 'encerrado', 'cancelado']
  const status = validStatuses.includes(rawStatus as PedidoCompraStatus)
    ? (rawStatus as PedidoCompraStatus)
    : 'all'

  return {
    q: parseParam(params?.q),
    status,
    adminId: parseParam(params?.adminId) || 'all',
    mesExtracao: parseParam(params?.mes) || null,
  }
}

export default async function PedidosPage({ searchParams }: PedidosPageProps) {
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
  const role = resolveMaintainerViewFromCookie(mviewCookie, currentAdminContext.email, secret) ?? actualRole
  const canViewGlobal = role === 'gestor' || role === 'viewer'

  const initialUser = {
    role,
    adminId: currentAdminContext.adminId,
    canViewGlobal,
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock title="Pedidos de Compra" />
      <PedidosWorkspace
        key={`${initialUser.adminId}:${initialUser.role}`}
        initialFilters={initialFilters}
        initialUser={initialUser}
      />
    </div>
  )
}
