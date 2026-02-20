import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OrdersWorkspace } from '@/components/orders/orders-workspace'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import type {
  OrdersPeriodModeOperational,
  OrdersWorkspaceFilters,
  UserRole,
} from '@/lib/types/database'

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

function firstParam(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

function parseOptionalInt(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

function parsePeriodMode(value: string | undefined): OrdersPeriodModeOperational {
  if (value === 'year' || value === 'year_month' || value === 'month' || value === 'range') return value
  return 'all'
}

function parseInitialFilters(raw: Awaited<OrdersPageProps['searchParams']>): OrdersWorkspaceFilters {
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1

  const periodMode = parsePeriodMode(firstParam(raw?.periodMode))
  const year = parseOptionalInt(firstParam(raw?.year)) ?? currentYear
  const month = parseOptionalInt(firstParam(raw?.month)) ?? currentMonth

  return {
    periodMode,
    year,
    month,
    startDate: parseDate(firstParam(raw?.startDate)),
    endDate: parseDate(firstParam(raw?.endDate)),
    q: (firstParam(raw?.q) ?? '').trim(),
    status: (firstParam(raw?.status) ?? 'todas').trim() || 'todas',
    responsavel: (firstParam(raw?.responsavel) ?? 'todos').trim() || 'todos',
    unidade: (firstParam(raw?.unidade) ?? '').trim(),
    prioridade: (firstParam(raw?.prioridade) ?? 'todas').trim() || 'todas',
    tipoOrdem: (firstParam(raw?.tipoOrdem) ?? 'PMOS').trim() || 'PMOS',
  }
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const initialFilters = parseInitialFilters(resolvedSearchParams)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    redirect('/login')
  }

  const { data: loggedAdmin, error: loggedAdminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (loggedAdminError || !loggedAdmin) {
    redirect('/login')
  }

  const latestSyncResult = await supabase
    .from('sync_log')
    .select('finished_at, status')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  const GUSTAVO_EMAIL = 'gustavoandrade@bemol.com.br'
  if (initialFilters.tipoOrdem === 'PMPL' && user.email !== GUSTAVO_EMAIL) {
    initialFilters.tipoOrdem = 'PMOS'
  }

  const initialUser = {
    role: loggedAdmin.role as UserRole,
    adminId: loggedAdmin.id,
    canViewGlobal: loggedAdmin.role === 'gestor',
    userEmail: user.email,
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Ordens"
        rightSlot={<LastSyncBadge timestamp={latestSyncResult.data?.finished_at ?? null} status={latestSyncResult.data?.status ?? null} />}
      />

      <OrdersWorkspace initialFilters={initialFilters} initialUser={initialUser} />
      <RealtimeListener />
    </div>
  )
}
