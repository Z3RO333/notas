import { createClient } from '@/lib/supabase/server'
import { DistributeButton } from '@/components/dashboard/distribute-button'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { ThroughputTrend } from '@/components/dashboard/throughput-trend'
import { TeamCapacity } from '@/components/dashboard/team-capacity'
import { ProductivityRanking } from '@/components/dashboard/productivity-ranking'
import { AlertsPanel } from '@/components/dashboard/alerts-panel'
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
import type {
  CargaAdministrador,
  DashboardFluxoDiario90d,
  DashboardProdutividade60d,
  SyncLog,
} from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const OPEN_STATUSES = ['nova', 'em_andamento', 'encaminhada_fornecedor'] as const
const OPEN_NOTAS_FIELDS = 'data_criacao_sap, created_at, status' as const

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const [cargaResult, unassignedResult, syncResult, fluxoResult, produtividadeResult, openNotasResult] = await Promise.all([
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
  ])

  const carga = (cargaResult.data ?? []) as CargaAdministrador[]
  const fluxoRows = (fluxoResult.data ?? []) as DashboardFluxoDiario90d[]
  const produtividadeRows = (produtividadeResult.data ?? []) as DashboardProdutividade60d[]
  const openNotas = (openNotasResult.data ?? []) as OpenNotaAgingRow[]
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
          <p className="text-sm text-muted-foreground">
            Visao executiva e operacional da distribuicao de notas
          </p>
        </div>
        <DistributeButton />
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

      <RealtimeListener />
    </div>
  )
}
