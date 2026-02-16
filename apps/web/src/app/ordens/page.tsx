import { createClient } from '@/lib/supabase/server'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersOwnerPanel } from '@/components/orders/orders-owner-panel'
import { OrdersPeriodFilter } from '@/components/orders/orders-period-filter'
import { OrdersRankingAdmin } from '@/components/orders/orders-ranking-admin'
import { OrdersRankingUnidade } from '@/components/orders/orders-ranking-unidade'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import {
  buildOrderKpisFromRpc,
  getOrdersCriticalityLevel,
} from '@/lib/orders/metrics'
import {
  normalizeTextParam,
  parseDateParam,
  parseMonthParam,
  parsePageParam,
  parsePageSizeParam,
  parseSortParam,
  parseYearParam,
  readFirstParam,
} from '@/lib/grid/query'
import type {
  GridFilterState,
  GridSortState,
  OrdemKpisRpc,
  OrdemNotaRankingAdmin,
  OrdemNotaRankingUnidade,
  OrdersKpiFilter,
  OrdersPeriodMode,
  OrderReassignTarget,
  OrdemNotaAcompanhamento,
  UserRole,
} from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const DEFAULT_SORT: GridSortState = { field: 'data', direction: 'desc' }
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'
const VALID_KPIS: OrdersKpiFilter[] = ['total', 'em_execucao', 'em_aberto', 'atrasadas', 'concluidas', 'avaliadas']
const AVALIADAS_RAW_STATUS = 'AVALIACAO_DA_EXECUCAO'
const VALID_PRIORIDADES = ['verde', 'amarelo', 'vermelho']

interface OrdersPageProps {
  searchParams?: Promise<{
    periodMode?: string | string[]
    year?: string | string[]
    month?: string | string[]
    startDate?: string | string[]
    endDate?: string | string[]
    kpi?: string | string[]
    q?: string | string[]
    status?: string | string[]
    responsavel?: string | string[]
    unidade?: string | string[]
    prioridade?: string | string[]
    sort?: string | string[]
    page?: string | string[]
    pageSize?: string | string[]
  }>
}

function toUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor') return value
  return null
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPeriod(
  periodMode: OrdersPeriodMode,
  year: number,
  month: number,
  startDateRaw: string,
  endDateRaw: string
): { startDate: string; endDate: string; startIso: string; endExclusiveIso: string } {
  if (periodMode === 'month') {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0))
    const endExclusive = new Date(Date.UTC(year, month, 1, 0, 0, 0))
    return {
      startDate: toIsoDate(start),
      endDate: toIsoDate(new Date(endExclusive.getTime() - 1)),
      startIso: start.toISOString(),
      endExclusiveIso: endExclusive.toISOString(),
    }
  }

  const today = new Date()
  const fallbackEnd = toIsoDate(today)
  const fallbackStart = toIsoDate(new Date(today.getTime() - (29 * 24 * 60 * 60 * 1000)))
  const startDate = startDateRaw || fallbackStart
  const endDate = endDateRaw || fallbackEnd

  const start = new Date(`${startDate}T00:00:00.000Z`)
  const endExclusive = new Date(`${endDate}T00:00:00.000Z`)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

  if (start > endExclusive) {
    const fixedStart = new Date(`${endDate}T00:00:00.000Z`)
    const fixedEndExclusive = new Date(`${startDate}T00:00:00.000Z`)
    fixedEndExclusive.setUTCDate(fixedEndExclusive.getUTCDate() + 1)
    return {
      startDate: endDate,
      endDate: startDate,
      startIso: fixedStart.toISOString(),
      endExclusiveIso: fixedEndExclusive.toISOString(),
    }
  }

  return {
    startDate,
    endDate,
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
  }
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
  const now = new Date()

  const periodModeRaw = readFirstParam(resolvedSearchParams?.periodMode)
  const periodMode: OrdersPeriodMode = periodModeRaw === 'custom' ? 'custom' : 'month'
  const year = parseYearParam(readFirstParam(resolvedSearchParams?.year), now.getUTCFullYear())
  const month = parseMonthParam(readFirstParam(resolvedSearchParams?.month), now.getUTCMonth() + 1)
  const startDateRaw = parseDateParam(readFirstParam(resolvedSearchParams?.startDate))
  const endDateRaw = parseDateParam(readFirstParam(resolvedSearchParams?.endDate))
  const period = getPeriod(periodMode, year, month, startDateRaw, endDateRaw)

  const kpiRaw = normalizeTextParam(readFirstParam(resolvedSearchParams?.kpi))
  const activeKpi = (VALID_KPIS.includes(kpiRaw as OrdersKpiFilter) ? kpiRaw : '') as OrdersKpiFilter | ''

  const q = normalizeTextParam(readFirstParam(resolvedSearchParams?.q))
  const status = normalizeTextParam(readFirstParam(resolvedSearchParams?.status))
  const responsavel = normalizeTextParam(readFirstParam(resolvedSearchParams?.responsavel))
  const unidade = normalizeTextParam(readFirstParam(resolvedSearchParams?.unidade))
  const prioridadeRaw = normalizeTextParam(readFirstParam(resolvedSearchParams?.prioridade))
  const prioridade = VALID_PRIORIDADES.includes(prioridadeRaw) ? prioridadeRaw : ''
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
    .select('id, nome, avatar_url')
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
    return (query as unknown as { eq: (column: string, value: string) => T }).eq('responsavel_atual_id', currentAdminId)
  }

  function applyBusinessFilters<T>(query: T): T {
    let next = query

    if (status && status !== 'todas') {
      if (status === 'avaliadas') {
        next = (next as unknown as { eq: (column: string, value: string) => T }).eq('status_ordem_raw', AVALIADAS_RAW_STATUS)
      } else {
        next = (next as unknown as { eq: (column: string, value: string) => T }).eq('status_ordem', status)
      }
    }

    if (canViewGlobal && responsavel && responsavel !== 'todos') {
      if (responsavel === '__sem_atual__') {
        next = (next as unknown as { is: (column: string, value: null) => T }).is('responsavel_atual_id', null)
      } else {
        next = (next as unknown as { eq: (column: string, value: string) => T }).eq('responsavel_atual_id', responsavel)
      }
    }

    if (unidade && unidade !== 'todas') {
      next = (next as unknown as { eq: (column: string, value: string) => T }).eq('unidade', unidade)
    }

    if (prioridade) {
      next = (next as unknown as { eq: (column: string, value: string) => T }).eq('semaforo_atraso', prioridade)
    }

    if (q) {
      const escaped = q.replace(/[%_]/g, '')
      next = (next as unknown as { or: (value: string) => T }).or(
        `numero_nota.ilike.%${escaped}%,ordem_codigo.ilike.%${escaped}%,descricao.ilike.%${escaped}%`
      )
    }

    return next
  }

  function applyKpiFilter<T>(query: T): T {
    if (!activeKpi || activeKpi === 'total') return query
    if (activeKpi === 'em_execucao') {
      return (query as unknown as { eq: (column: string, value: string) => T }).eq('status_ordem', 'em_tratativa')
    }
    if (activeKpi === 'em_aberto') {
      return (query as unknown as { eq: (column: string, value: string) => T }).eq('status_ordem', 'aberta')
    }
    if (activeKpi === 'avaliadas') {
      return (query as unknown as { eq: (column: string, value: string) => T }).eq('status_ordem_raw', AVALIADAS_RAW_STATUS)
    }
    if (activeKpi === 'atrasadas') {
      return (query as unknown as { eq: (column: string, value: string) => T }).eq('semaforo_atraso', 'vermelho')
    }
    return (query as unknown as { in: (column: string, values: string[]) => T }).in('status_ordem', ['concluida', 'cancelada'])
  }

  // Paged data query
  let pagedQuery = supabase
    .from('vw_ordens_notas_painel')
    .select('*', { count: 'exact' })
    .gte('ordem_detectada_em', period.startIso)
    .lt('ordem_detectada_em', period.endExclusiveIso)

  pagedQuery = applyVisibilityFilter(pagedQuery)
  pagedQuery = applyBusinessFilters(pagedQuery)
  pagedQuery = applyKpiFilter(pagedQuery)

  for (const orderRule of mapSortToColumns(sort)) {
    pagedQuery = pagedQuery.order(orderRule.column, { ascending: orderRule.ascending })
  }

  // KPIs via RPC (single aggregation query instead of fetching all rows)
  const kpisRpcPromise = supabase.rpc('calcular_kpis_ordens', {
    p_start_iso: period.startIso,
    p_end_exclusive_iso: period.endExclusiveIso,
    p_admin_id: canViewGlobal ? null : currentAdminId,
    p_status: (status && status !== 'todas') ? status : null,
    p_unidade: (unidade && unidade !== 'todas') ? unidade : null,
    p_responsavel: canViewGlobal ? (responsavel || null) : null,
  })

  // Rankings via RPC (only for gestor)
  const rankingAdminPromise = canViewGlobal
    ? supabase.rpc('calcular_ranking_ordens_admin', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
    })
    : Promise.resolve({ data: null, error: null })

  const rankingUnidadePromise = canViewGlobal
    ? supabase.rpc('calcular_ranking_ordens_unidade', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
    })
    : Promise.resolve({ data: null, error: null })

  const latestSyncPromise = supabase
    .from('sync_log')
    .select('finished_at, status')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  // Unidades for filter options (lightweight query)
  const unidadesPromise = supabase
    .from('vw_ordens_notas_painel')
    .select('unidade')
    .gte('ordem_detectada_em', period.startIso)
    .lt('ordem_detectada_em', period.endExclusiveIso)
    .not('unidade', 'is', null)

  // Run all queries in parallel
  const [rowsResult, kpisRpcResult, rankingAdminResult, rankingUnidadeResult, latestSyncResult, unidadesResult] =
    await Promise.all([
      pagedQuery.range(from, to),
      kpisRpcPromise,
      rankingAdminPromise,
      rankingUnidadePromise,
      latestSyncPromise,
      unidadesPromise,
    ])

  const rows = (rowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  const total = rowsResult.count ?? 0
  const windowDays = Math.max(
    Math.ceil((new Date(period.endExclusiveIso).getTime() - new Date(period.startIso).getTime()) / (24 * 60 * 60 * 1000)),
    1
  )

  // KPIs from RPC
  const kpisRaw = (kpisRpcResult.data ?? {
    total: 0, abertas: 0, em_tratativa: 0, concluidas: 0,
    canceladas: 0, avaliadas: 0, atrasadas_7d: 0, sem_responsavel: 0,
  }) as OrdemKpisRpc
  const orderKpis = buildOrderKpisFromRpc(kpisRaw)
  const criticality = getOrdersCriticalityLevel(orderKpis.total_ordens_30d, orderKpis.qtd_antigas_7d_30d)

  // Rankings from RPC
  const rankingAdmin = (rankingAdminResult.data ?? []) as OrdemNotaRankingAdmin[]
  const rankingUnidade = (rankingUnidadeResult.data ?? []) as OrdemNotaRankingUnidade[]

  const semResponsavelCount = canViewGlobal ? (kpisRaw.sem_responsavel ?? 0) : 0

  const responsavelOptions = [
    { value: 'todos', label: 'Todos os responsaveis' },
    { value: '__sem_atual__', label: 'Sem responsavel atual' },
    ...(adminsResult.data ?? []).map((admin) => ({ value: admin.id, label: admin.nome })),
  ]

  const unidadeNames = Array.from(
    new Set(
      ((unidadesResult.data ?? []) as Array<{ unidade: string | null }>)
        .map((row) => row.unidade)
        .filter(Boolean) as string[]
    )
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'))

  const unidadeOptions = [
    { value: 'todas', label: 'Todas as unidades' },
    ...unidadeNames.map((name) => ({ value: name, label: name })),
  ]

  const avatarById = Object.fromEntries(
    (adminsResult.data ?? []).map((admin) => [admin.id, admin.avatar_url ?? null])
  ) as Record<string, string | null>

  const filters: GridFilterState = { q, status, responsavel, unidade }
  const latestSync = latestSyncResult.data ?? null

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Ordens"
        rightSlot={<LastSyncBadge timestamp={latestSync?.finished_at ?? null} status={latestSync?.status ?? null} />}
      />

      <OrdersPeriodFilter
        periodMode={periodMode}
        year={year}
        month={month}
        startDate={period.startDate}
        endDate={period.endDate}
      />

      <OrdersKpiStrip
        kpis={orderKpis}
        activeKpi={activeKpi || null}
        criticality={criticality}
      />

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
        prioridade={prioridade}
        activeKpi={activeKpi || null}
        canViewGlobal={canViewGlobal}
        canReassign={canViewGlobal}
        reassignTargets={reassignTargets}
        responsavelOptions={responsavelOptions}
        unidadeOptions={unidadeOptions}
        avatarById={avatarById}
        semResponsavelCount={semResponsavelCount}
        canCopyOrders={Boolean(currentUserRole)}
        periodStartIso={period.startIso}
        periodEndExclusiveIso={period.endExclusiveIso}
        currentAdminId={canViewGlobal ? null : currentAdminId}
      />

      {canViewGlobal && (
        <>
          <OrdersRankingAdmin rows={rankingAdmin.slice(0, 12)} windowDays={windowDays} />
          <OrdersRankingUnidade rows={rankingUnidade.slice(0, 12)} windowDays={windowDays} />
        </>
      )}

      <RealtimeListener />
    </div>
  )
}
