import { createClient } from '@/lib/supabase/server'
import { DistributeButton } from '@/components/dashboard/distribute-button'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
import { AdminPeriodFilter } from '@/components/dashboard/admin-period-filter'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { ThroughputTrend } from '@/components/dashboard/throughput-trend'
import { TeamCapacity } from '@/components/dashboard/team-capacity'
import { ProductivityRanking } from '@/components/dashboard/productivity-ranking'
import { AlertsPanel } from '@/components/dashboard/alerts-panel'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersAgingTable } from '@/components/orders/orders-aging-table'
import { OrdersRankingAdmin } from '@/components/orders/orders-ranking-admin'
import { OrdersRankingUnidade } from '@/components/orders/orders-ranking-unidade'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import {
  buildAlerts,
  buildKpis,
  buildProductivityRanking,
  buildTeamCapacityRows,
  buildThroughputRange,
} from '@/lib/dashboard/metrics'
import { resolveAdminDashboardPeriod, type AdminDashboardSearchParams } from '@/lib/dashboard/period'
import {
  getOrdersCriticalityLevel,
  workspaceKpisToOrdemNotaKpis,
} from '@/lib/orders/metrics'
import type {
  CargaAdministrador,
  DashboardFluxoDiario90d,
  DashboardNotasMetricsRpc,
  DashboardProdutividade60d,
  DashboardProdutividadePeriodoRpc,
  OrdemNotaAcompanhamento,
  OrdemNotaKpis,
  OrdemNotaRankingAdmin,
  OrdemNotaRankingUnidade,
  OrderReassignTarget,
  OrdersWorkspaceKpis,
  SyncLog,
} from '@/lib/types/database'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'

export const dynamic = 'force-dynamic'

const DASHBOARD_ORDERS_LIMIT = 20

interface AdminDashboardPageProps {
  searchParams?: Promise<AdminDashboardSearchParams>
}

function includesToken(haystack: string | null | undefined, token: string): boolean {
  return (haystack ?? '').toLowerCase().includes(token.toLowerCase())
}

function isRpcWithoutTipoOrdemSupport(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true

  return (
    includesToken(error.message, 'p_tipo_ordem')
    || includesToken(error.details, 'p_tipo_ordem')
    || includesToken(error.hint, 'p_tipo_ordem')
  )
}

async function callRpcWithOptionalTipoOrdem<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const withTipo = await supabase.rpc(rpcName, params)
  if (withTipo.error && isRpcWithoutTipoOrdemSupport(withTipo.error)) {
    const withoutTipoParams = { ...params }
    delete withoutTipoParams.p_tipo_ordem

    const fallback = await supabase.rpc(rpcName, withoutTipoParams)
    return {
      data: (fallback.data ?? null) as T | null,
      error: fallback.error ? { code: fallback.error.code, message: fallback.error.message } : null,
    }
  }

  return {
    data: (withTipo.data ?? null) as T | null,
    error: withTipo.error ? { code: withTipo.error.code, message: withTipo.error.message } : null,
  }
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveAdminDashboardPeriod(resolvedSearchParams)
  const now = new Date()

  const [
    cargaResult,
    syncResult,
    notasMetricsResult,
    fluxoResult,
    produtividadeResult,
    orderKpisResult,
    ordensRowsResult,
    pmplKpisResult,
    pmplRowsResult,
    rankingAdminResult,
    rankingUnidadeResult,
    reassignTargetsResult,
  ] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('nome'),
    supabase.from('sync_log').select('*').order('started_at', { ascending: false }).limit(1),
    supabase.rpc('calcular_metricas_notas_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
    }),
    supabase.rpc('listar_fluxo_notas_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
    }),
    supabase.rpc('calcular_produtividade_notas_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
    }),
    supabase.rpc('calcular_kpis_ordens_operacional', {
      p_period_mode: 'range',
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_year: null,
      p_month: null,
      p_status: null,
      p_unidade: null,
      p_responsavel: null,
      p_prioridade: null,
      p_q: null,
      p_admin_scope: null,
      p_tipo_ordem: 'PMOS',
    }),
    supabase.rpc('buscar_ordens_prioritarias_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_limit: DASHBOARD_ORDERS_LIMIT,
      p_tipo_ordem: 'PMOS',
    }),
    supabase.rpc('calcular_kpis_ordens_operacional', {
      p_period_mode: 'range',
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_year: null,
      p_month: null,
      p_status: null,
      p_unidade: null,
      p_responsavel: null,
      p_prioridade: null,
      p_q: null,
      p_admin_scope: null,
      p_tipo_ordem: 'PMPL',
    }),
    supabase.rpc('buscar_ordens_prioritarias_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_limit: DASHBOARD_ORDERS_LIMIT,
      p_tipo_ordem: 'PMPL',
    }),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingAdmin[]>(
      supabase,
      'calcular_ranking_ordens_admin',
      {
        p_start_iso: period.startIso,
        p_end_exclusive_iso: period.endExclusiveIso,
        p_tipo_ordem: 'PMOS',
      }
    ),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingUnidade[]>(
      supabase,
      'calcular_ranking_ordens_unidade',
      {
        p_start_iso: period.startIso,
        p_end_exclusive_iso: period.endExclusiveIso,
        p_tipo_ordem: 'PMOS',
      }
    ),
    supabase
      .from('administradores')
      .select('id, nome')
      .eq('role', 'admin')
      .eq('ativo', true)
      .eq('em_ferias', false)
      .order('nome'),
  ])

  const firstError = [
    cargaResult.error,
    syncResult.error,
    notasMetricsResult.error,
    fluxoResult.error,
    produtividadeResult.error,
    orderKpisResult.error,
    ordensRowsResult.error,
    pmplKpisResult.error,
    pmplRowsResult.error,
    rankingAdminResult.error,
    rankingUnidadeResult.error,
    reassignTargetsResult.error,
  ].find(Boolean)
  if (firstError) throw firstError

  const carga = (cargaResult.data ?? []) as CargaAdministrador[]
  const notasMetrics = ((notasMetricsResult.data ?? {}) as Partial<DashboardNotasMetricsRpc>)
  const fluxoRows = (fluxoResult.data ?? []) as DashboardFluxoDiario90d[]
  const produtividadeRowsRaw = (produtividadeResult.data ?? []) as DashboardProdutividadePeriodoRpc[]
  const produtividadeRows: DashboardProdutividade60d[] = produtividadeRowsRaw.map((row) => ({
    administrador_id: row.administrador_id,
    nome: row.nome,
    avatar_url: row.avatar_url,
    especialidade: row.especialidade as DashboardProdutividade60d['especialidade'],
    concluidas_30d: Number(row.concluidas_periodo ?? 0),
    concluidas_prev_30d: Number(row.concluidas_periodo_anterior ?? 0),
  }))
  const ordensRows = (ordensRowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  const rankingAdminRaw = (rankingAdminResult.data ?? []) as Partial<OrdemNotaRankingAdmin>[]
  const rankingUnidadeRaw = (rankingUnidadeResult.data ?? []) as Partial<OrdemNotaRankingUnidade>[]
  const reassignTargets = (reassignTargetsResult.data ?? []) as OrderReassignTarget[]
  const latestSync = ((syncResult.data ?? []) as SyncLog[])[0] ?? null
  const throughput = buildThroughputRange(fluxoRows)
  const summary: DashboardSummaryMetrics = {
    abertas_agora: Number(notasMetrics.abertas_periodo ?? 0),
    sem_atribuir: Number(notasMetrics.sem_atribuir_periodo ?? 0),
    aging_48h: Number(notasMetrics.aging_48h_periodo ?? 0),
    entradas_30d: Number(notasMetrics.qtd_notas_criadas_periodo ?? 0),
    concluidas_30d: Number(notasMetrics.qtd_concluidas_periodo ?? 0),
    notas_convertidas_30d: Number(notasMetrics.qtd_notas_convertidas_periodo ?? 0),
    taxa_nota_ordem_30d: Number(notasMetrics.taxa_nota_ordem_periodo ?? 0),
    taxa_fechamento_30d: Number(notasMetrics.taxa_fechamento_periodo ?? 0),
  }
  const kpis = buildKpis(summary)
  const alerts = buildAlerts({ summary, latestSync, now })
  const teamCapacityRows = buildTeamCapacityRows(carga)
  const productivityRows = buildProductivityRanking(produtividadeRows)
  const rawOrderKpis = (orderKpisResult.data ?? {}) as Partial<OrdersWorkspaceKpis>
  const orderKpis: OrdemNotaKpis = workspaceKpisToOrdemNotaKpis({
    total: Number(rawOrderKpis.total ?? 0),
    abertas: Number(rawOrderKpis.abertas ?? 0),
    em_tratativa: Number(rawOrderKpis.em_tratativa ?? 0),
    em_avaliacao: Number(rawOrderKpis.em_avaliacao ?? 0),
    concluidas: Number(rawOrderKpis.concluidas ?? 0),
    canceladas: Number(rawOrderKpis.canceladas ?? 0),
    avaliadas: Number(rawOrderKpis.avaliadas ?? 0),
    atrasadas: Number(rawOrderKpis.atrasadas ?? 0),
    sem_responsavel: 0,
  })
  const ordersCriticality = getOrdersCriticalityLevel(orderKpis.total_ordens_30d, orderKpis.qtd_antigas_7d_30d)
  const rawPmplKpis = (pmplKpisResult.data ?? {}) as Partial<OrdersWorkspaceKpis>
  const pmplOrderKpis: OrdemNotaKpis = workspaceKpisToOrdemNotaKpis({
    total: Number(rawPmplKpis.total ?? 0),
    abertas: Number(rawPmplKpis.abertas ?? 0),
    em_tratativa: Number(rawPmplKpis.em_tratativa ?? 0),
    em_avaliacao: Number(rawPmplKpis.em_avaliacao ?? 0),
    concluidas: Number(rawPmplKpis.concluidas ?? 0),
    canceladas: Number(rawPmplKpis.canceladas ?? 0),
    avaliadas: Number(rawPmplKpis.avaliadas ?? 0),
    atrasadas: Number(rawPmplKpis.atrasadas ?? 0),
    sem_responsavel: 0,
  })
  const pmplOrdersCriticality = getOrdersCriticalityLevel(pmplOrderKpis.total_ordens_30d, pmplOrderKpis.qtd_antigas_7d_30d)
  const pmplOrdensRows = (pmplRowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  const rankingAdmin: OrdemNotaRankingAdmin[] = rankingAdminRaw.map((row) => ({
    administrador_id: row.administrador_id ?? '',
    nome: row.nome ?? 'Sem nome',
    qtd_ordens_30d: Number(row.qtd_ordens_30d ?? 0),
    qtd_abertas_30d: Number(row.qtd_abertas_30d ?? 0),
    qtd_em_tratativa_30d: Number(row.qtd_em_tratativa_30d ?? 0),
    qtd_concluidas_30d: Number(row.qtd_concluidas_30d ?? 0),
    qtd_canceladas_30d: Number(row.qtd_canceladas_30d ?? 0),
    qtd_antigas_7d_30d: Number(row.qtd_antigas_7d_30d ?? 0),
    tempo_medio_geracao_dias_30d: row.tempo_medio_geracao_dias_30d === null || row.tempo_medio_geracao_dias_30d === undefined
      ? null
      : Number(row.tempo_medio_geracao_dias_30d),
  }))
  const rankingUnidade: OrdemNotaRankingUnidade[] = rankingUnidadeRaw.map((row) => ({
    unidade: row.unidade ?? 'Sem unidade',
    qtd_ordens_30d: Number(row.qtd_ordens_30d ?? 0),
    qtd_abertas_30d: Number(row.qtd_abertas_30d ?? 0),
    qtd_em_tratativa_30d: Number(row.qtd_em_tratativa_30d ?? 0),
    qtd_antigas_7d_30d: Number(row.qtd_antigas_7d_30d ?? 0),
    tempo_medio_geracao_dias_30d: row.tempo_medio_geracao_dias_30d === null || row.tempo_medio_geracao_dias_30d === undefined
      ? null
      : Number(row.tempo_medio_geracao_dias_30d),
  }))

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

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Notas</h2>
            <p className="text-sm text-muted-foreground">
              Entrada, conversão e fechamento no período selecionado.
            </p>
          </div>
          <AdminPeriodFilter
            periodPreset={period.preset}
            startDate={period.startDate}
            endDate={period.endDate}
          />
        </div>

        <KpiStrip items={kpis} />

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ThroughputTrend data={throughput} spanDays={period.spanDays} periodLabel={period.periodLabel} />
          </div>
          <AlertsPanel alerts={alerts} latestSync={latestSync} />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ProductivityRanking rows={productivityRows} periodLabel={period.periodLabel} />
          </div>
          <TeamCapacity rows={teamCapacityRows} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Acompanhamento PMOS</h2>
            <p className="text-sm text-muted-foreground">
              Ordens de manutenção operacional (PMOS) no período selecionado.
            </p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            Período: {period.periodLabel}
          </span>
        </div>

        <OrdersKpiStrip
          kpis={orderKpis}
          activeKpi={null}
          criticality={ordersCriticality}
          interactive={false}
        />

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <OrdersAgingTable
              rows={ordensRows}
              title={`Ordens PMOS acompanhadas (${period.periodLabel})`}
              maxRows={20}
              showAdminColumns
              canReassign
              reassignTargets={reassignTargets}
              currentUserRole="gestor"
            />
          </div>
          <OrdersRankingUnidade rows={rankingUnidade.slice(0, 12)} periodLabel={period.periodLabel} />
        </div>

        <OrdersRankingAdmin rows={rankingAdmin.slice(0, 12)} periodLabel={period.periodLabel} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Acompanhamento PMPL</h2>
            <p className="text-sm text-muted-foreground">
              Ordens de manutenção planejada (PMPL) no período selecionado.
            </p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            Período: {period.periodLabel}
          </span>
        </div>

        <OrdersKpiStrip
          kpis={pmplOrderKpis}
          activeKpi={null}
          criticality={pmplOrdersCriticality}
          interactive={false}
        />

        <OrdersAgingTable
          rows={pmplOrdensRows}
          title={`Ordens PMPL acompanhadas (${period.periodLabel})`}
          maxRows={20}
          showAdminColumns
          canReassign
          reassignTargets={reassignTargets}
          currentUserRole="gestor"
        />
      </section>

      <RealtimeListener />
    </div>
  )
}
