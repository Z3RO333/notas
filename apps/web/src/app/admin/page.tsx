import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DistributeButton } from '@/components/dashboard/distribute-button'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
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
  buildDashboardSummary,
  buildKpis,
  buildProductivityRanking,
  buildTeamCapacityRows,
  buildThroughput30d,
  type OpenNotaAgingRow,
} from '@/lib/dashboard/metrics'
import {
  buildOrderKpis,
  getOrdersCriticalityLevel,
  buildOrderRankingAdmin,
  buildOrderRankingUnidade,
  parseOrderWindow,
} from '@/lib/orders/metrics'
import type {
  CargaAdministrador,
  DashboardFluxoDiario90d,
  DashboardProdutividade60d,
  OrdemNotaAcompanhamento,
  OrderWindowFilter,
  OrderReassignTarget,
  SyncLog,
} from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const OPEN_STATUSES = ['nova', 'em_andamento', 'encaminhada_fornecedor'] as const
const OPEN_NOTAS_FIELDS = 'data_criacao_sap, created_at, status' as const
const ORDER_WINDOW_OPTIONS: OrderWindowFilter[] = [30, 90, 180]
const ORDERS_FETCH_PAGE_SIZE = 1000

interface AdminDashboardPageProps {
  searchParams?: Promise<{
    janela?: string | string[]
  }>
}

type AdminDashboardSearchParams = {
  janela?: string | string[]
}

function getSelectedWindow(searchParams?: AdminDashboardSearchParams): OrderWindowFilter {
  const raw = Array.isArray(searchParams?.janela)
    ? searchParams.janela[0]
    : searchParams?.janela
  return parseOrderWindow(raw)
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const orderWindow = getSelectedWindow(resolvedSearchParams)
  const ordersCutoff = new Date()
  ordersCutoff.setUTCDate(ordersCutoff.getUTCDate() - (orderWindow - 1))

  const [cargaResult, unassignedResult, syncResult, fluxoResult, produtividadeResult, openNotasResult, reassignTargetsResult] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('nome'),
    supabase
      .from('notas_manutencao')
      .select('id', { count: 'exact', head: true })
      .is('administrador_id', null)
      .eq('status', 'nova'),
    supabase.from('sync_log').select('*').order('started_at', { ascending: false }).limit(1),
    supabase.from('vw_dashboard_fluxo_diario_90d').select('*').order('dia', { ascending: true }),
    supabase.from('vw_dashboard_produtividade_60d').select('*').order('concluidas_30d', { ascending: false }),
    supabase
      .from('notas_manutencao')
      .select(OPEN_NOTAS_FIELDS)
      .in('status', OPEN_STATUSES),
    supabase
      .from('administradores')
      .select('id, nome')
      .eq('role', 'admin')
      .eq('ativo', true)
      .eq('em_ferias', false)
      .order('nome'),
  ])

  const ordensRows: OrdemNotaAcompanhamento[] = []
  for (let offset = 0; ; offset += ORDERS_FETCH_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('vw_ordens_notas_painel')
      .select('*')
      .gte('ordem_detectada_em', ordersCutoff.toISOString())
      .order('ordem_detectada_em', { ascending: false })
      .range(offset, offset + ORDERS_FETCH_PAGE_SIZE - 1)

    if (error) throw error
    const batch = (data ?? []) as OrdemNotaAcompanhamento[]
    ordensRows.push(...batch)
    if (batch.length < ORDERS_FETCH_PAGE_SIZE) break
  }

  const carga = (cargaResult.data ?? []) as CargaAdministrador[]
  const fluxoRows = (fluxoResult.data ?? []) as DashboardFluxoDiario90d[]
  const produtividadeRows = (produtividadeResult.data ?? []) as DashboardProdutividade60d[]
  const openNotas = (openNotasResult.data ?? []) as OpenNotaAgingRow[]
  const reassignTargets = (reassignTargetsResult.data ?? []) as OrderReassignTarget[]
  const latestSync = ((syncResult.data ?? []) as SyncLog[])[0] ?? null
  const now = new Date()
  const notasSemAtribuir = unassignedResult.count ?? 0
  const throughput30d = buildThroughput30d(fluxoRows, now)
  const summary = buildDashboardSummary({
    carga,
    notasSemAtribuir,
    notasAbertas: openNotas,
    throughput30d,
    now,
  })
  const kpis = buildKpis(summary)
  const alerts = buildAlerts({ summary, latestSync, now })
  const teamCapacityRows = buildTeamCapacityRows(carga)
  const productivityRows = buildProductivityRanking(produtividadeRows)
  const orderKpis = buildOrderKpis(ordensRows)
  const ordersCriticality = getOrdersCriticalityLevel(orderKpis.total_ordens_30d, orderKpis.qtd_antigas_7d_30d)
  const rankingAdmin = buildOrderRankingAdmin(ordensRows)
  const rankingUnidade = buildOrderRankingUnidade(ordensRows)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
          <p className="text-sm text-muted-foreground">
            Visao executiva e operacional da distribuicao de notas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DashboardHeaderActions />
          <DistributeButton />
        </div>
      </div>

      <KpiStrip items={kpis} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ThroughputTrend data={throughput30d} />
        </div>
        <AlertsPanel alerts={alerts} latestSync={latestSync} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProductivityRanking rows={productivityRows} />
        </div>
        <TeamCapacity rows={teamCapacityRows} />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Acompanhamento de Ordens (origem nota)</h2>
            <p className="text-sm text-muted-foreground">
              Semaforo de envelhecimento, responsavel atual e historico de envolvidos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {ORDER_WINDOW_OPTIONS.map((windowDays) => (
              <Link
                key={windowDays}
                href={`/admin?janela=${windowDays}`}
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
              title={`Ordens acompanhadas (${orderWindow}d)`}
              maxRows={20}
              showAdminColumns
              canReassign
              reassignTargets={reassignTargets}
              currentUserRole="gestor"
            />
          </div>
          <OrdersRankingUnidade rows={rankingUnidade.slice(0, 12)} windowDays={orderWindow} />
        </div>

        <OrdersRankingAdmin rows={rankingAdmin.slice(0, 12)} windowDays={orderWindow} />
      </section>

      <RealtimeListener />
    </div>
  )
}
