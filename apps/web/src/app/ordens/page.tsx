import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersRankingAdmin } from '@/components/orders/orders-ranking-admin'
import { OrdersRankingUnidade } from '@/components/orders/orders-ranking-unidade'
import { OrdersOwnerPanel } from '@/components/orders/orders-owner-panel'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import {
  buildOrderKpis,
  buildOrderRankingAdmin,
  buildOrderRankingUnidade,
  parseOrderWindow,
} from '@/lib/orders/metrics'
import {
  normalizeTextParam,
  parsePageParam,
  parsePageSizeParam,
  parseSortParam,
  readFirstParam,
} from '@/lib/grid/query'
import type {
  GridFilterState,
  GridSortState,
  OrderReassignTarget,
  OrderWindowFilter,
  OrdemNotaAcompanhamento,
  UserRole,
} from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const ORDER_WINDOW_OPTIONS: OrderWindowFilter[] = [30, 90, 180]
const DEFAULT_SORT: GridSortState = { field: 'data', direction: 'desc' }
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'

interface OrdersPageProps {
  searchParams?: Promise<{
    janela?: string | string[]
    q?: string | string[]
    status?: string | string[]
    responsavel?: string | string[]
    unidade?: string | string[]
    sort?: string | string[]
    page?: string | string[]
    pageSize?: string | string[]
  }>
}

type OrdersSearchParams = {
  janela?: string | string[]
}

function getSelectedWindow(searchParams?: OrdersSearchParams): OrderWindowFilter {
  const raw = Array.isArray(searchParams?.janela)
    ? searchParams.janela[0]
    : searchParams?.janela
  return parseOrderWindow(raw)
}

function toUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor') return value
  return null
}

function mapSortToColumns(sort: GridSortState): Array<{ column: string; ascending: boolean }> {
  if (sort.field === 'ordem') return [{ column: 'ordem_codigo', ascending: sort.direction === 'asc' }]
  if (sort.field === 'status') return [{ column: 'status_ordem', ascending: sort.direction === 'asc' }]
  if (sort.field === 'responsavel') return [{ column: 'responsavel_atual_id', ascending: sort.direction === 'asc' }]
  if (sort.field === 'unidade') return [{ column: 'unidade', ascending: sort.direction === 'asc' }]
  if (sort.field === 'idade') return [{ column: 'dias_em_aberto', ascending: sort.direction === 'asc' }]
  return [{ column: 'ordem_detectada_em', ascending: sort.direction === 'asc' }]
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const orderWindow = getSelectedWindow(resolvedSearchParams)
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - (orderWindow - 1))

  const q = normalizeTextParam(readFirstParam(resolvedSearchParams?.q))
  const status = normalizeTextParam(readFirstParam(resolvedSearchParams?.status))
  const responsavel = normalizeTextParam(readFirstParam(resolvedSearchParams?.responsavel))
  const unidade = normalizeTextParam(readFirstParam(resolvedSearchParams?.unidade))
  const sort = parseSortParam(readFirstParam(resolvedSearchParams?.sort), DEFAULT_SORT)
  const page = parsePageParam(readFirstParam(resolvedSearchParams?.page))
  const pageSize = parsePageSizeParam(readFirstParam(resolvedSearchParams?.pageSize), [20, 50, 100])

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data: { user } } = await supabase.auth.getUser()

  const loggedAdminResult = user?.email
    ? await supabase
      .from('administradores')
      .select('id, role')
      .eq('email', user.email)
      .single()
    : { data: null }

  const currentAdminId = loggedAdminResult.data?.id ?? null
  const currentUserRole = toUserRole(loggedAdminResult.data?.role)
  const canViewGlobal = currentUserRole === 'gestor'

  const adminsResult = await supabase
    .from('administradores')
    .select('id, nome')
    .eq('role', 'admin')
    .eq('ativo', true)
    .eq('em_ferias', false)
    .order('nome')

  const reassignTargets = canViewGlobal
    ? ((adminsResult.data ?? []) as OrderReassignTarget[])
    : []

  function applyVisibilityFilter<T>(query: T): T {
    if (canViewGlobal) return query
    if (!currentAdminId) return (query as unknown as { eq: (column: string, value: string) => T }).eq('nota_id', EMPTY_UUID)

    return (query as unknown as { or: (value: string) => T }).or(
      `responsavel_atual_id.eq.${currentAdminId},administrador_id.eq.${currentAdminId},envolvidos_admin_ids.cs.{${currentAdminId}}`
    )
  }

  function applyBusinessFilters<T>(query: T): T {
    let next = query

    if (status) {
      next = (next as unknown as { eq: (column: string, value: string) => T }).eq('status_ordem', status)
    }

    if (canViewGlobal && responsavel) {
      next = (next as unknown as { eq: (column: string, value: string) => T }).eq('responsavel_atual_id', responsavel)
    }

    if (unidade) {
      next = (next as unknown as { eq: (column: string, value: string) => T }).eq('unidade', unidade)
    }

    if (q) {
      const escaped = q.replace(/[%_]/g, '')
      next = (next as unknown as { or: (value: string) => T }).or(
        `numero_nota.ilike.%${escaped}%,ordem_codigo.ilike.%${escaped}%,descricao.ilike.%${escaped}%`
      )
    }

    return next
  }

  let pagedQuery = supabase
    .from('vw_ordens_notas_painel')
    .select('*', { count: 'exact' })
    .gte('ordem_detectada_em', cutoff.toISOString())

  pagedQuery = applyVisibilityFilter(pagedQuery)
  pagedQuery = applyBusinessFilters(pagedQuery)

  for (const orderRule of mapSortToColumns(sort)) {
    pagedQuery = pagedQuery.order(orderRule.column, { ascending: orderRule.ascending })
  }

  const rowsResult = await pagedQuery.range(from, to)

  let metricsQuery = supabase
    .from('vw_ordens_notas_painel')
    .select('*')
    .gte('ordem_detectada_em', cutoff.toISOString())
    .limit(5000)

  metricsQuery = applyVisibilityFilter(metricsQuery)
  metricsQuery = applyBusinessFilters(metricsQuery)

  const [metricsRowsResult, latestSyncResult] = await Promise.all([
    metricsQuery,
    supabase
      .from('sync_log')
      .select('finished_at, status')
      .order('started_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  const rows = (rowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  const total = rowsResult.count ?? 0
  const metricsRows = (metricsRowsResult.data ?? []) as OrdemNotaAcompanhamento[]

  const orderKpis = buildOrderKpis(metricsRows)
  const rankingAdmin = canViewGlobal ? buildOrderRankingAdmin(metricsRows) : []
  const rankingUnidade = canViewGlobal ? buildOrderRankingUnidade(metricsRows) : []

  const responsavelOptions = [
    { value: 'todos', label: 'Todos os responsaveis' },
    ...(adminsResult.data ?? []).map((admin) => ({ value: admin.id, label: admin.nome })),
  ]

  const unidadeOptions = [
    { value: 'todas', label: 'Todas as unidades' },
    ...Array.from(new Set(metricsRows.map((row) => row.unidade).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((name) => ({ value: name, label: name })),
  ]

  const filters: GridFilterState = {
    q,
    status,
    responsavel,
    unidade,
  }

  const latestSync = latestSyncResult.data ?? null

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Ordens"
        subtitle="Acompanhamento operacional de ordens originadas de notas."
        rightSlot={<LastSyncBadge timestamp={latestSync?.finished_at ?? null} status={latestSync?.status ?? null} />}
      />

      <div className="flex items-center gap-2">
        {ORDER_WINDOW_OPTIONS.map((windowDays) => (
          <Link
            key={windowDays}
            href={`/ordens?janela=${windowDays}`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              orderWindow === windowDays
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {windowDays} dias
          </Link>
        ))}
      </div>

      <OrdersKpiStrip kpis={orderKpis} windowDays={orderWindow} />

      <OrdersOwnerPanel
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        q={filters.q ?? ''}
        status={filters.status ?? ''}
        responsavel={filters.responsavel ?? ''}
        unidade={filters.unidade ?? ''}
        canViewGlobal={canViewGlobal}
        canReassign={canViewGlobal}
        reassignTargets={reassignTargets}
        responsavelOptions={responsavelOptions}
        unidadeOptions={unidadeOptions}
      />

      {canViewGlobal && (
        <>
          <OrdersRankingAdmin rows={rankingAdmin.slice(0, 12)} windowDays={orderWindow} />
          <OrdersRankingUnidade rows={rankingUnidade.slice(0, 12)} windowDays={orderWindow} />
        </>
      )}

      <RealtimeListener />
    </div>
  )
}
