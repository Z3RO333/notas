import { createAdminClient } from '@/lib/supabase/admin'
import { AlertsPanel } from '@/components/dashboard/alerts-panel'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { ProductivityRanking } from '@/components/dashboard/productivity-ranking'
import { TeamCapacity } from '@/components/dashboard/team-capacity'
import { ThroughputTrend } from '@/components/dashboard/throughput-trend'
import { resolveAvatarUrl } from '@/lib/collaborator/avatar-presentation'
import {
  buildAlerts,
  buildKpis,
  buildProductivityRanking,
  buildTeamCapacityRows,
  buildThroughputRange,
} from '@/lib/dashboard/metrics'
import type { AdminDashboardPeriod } from '@/lib/dashboard/period'
import type {
  CargaAdministrador,
  DashboardFluxoDiario90d,
  DashboardNotasMetricsRpc,
  DashboardProdutividade60d,
  DashboardProdutividadePeriodoRpc,
  SyncHealthRow,
  SyncLog,
} from '@/lib/types/database'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'

interface AdminNotesSectionProps {
  period: AdminDashboardPeriod
}

export async function AdminNotesSection({ period }: AdminNotesSectionProps) {
  const supabase = createAdminClient()
  const now = new Date()

  const [
    cargaResult,
    adminIdsResult,
    syncResult,
    syncHealthResult,
    notasMetricsResult,
    fluxoResult,
    produtividadeResult,
  ] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('nome'),
    supabase.from('administradores').select('id').eq('role', 'admin'),
    supabase.from('sync_log').select('id, started_at, finished_at, status').order('started_at', { ascending: false }).limit(1),
    supabase.rpc('buscar_sync_health', { p_job: 'fast' }),
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
  ])

  const firstError = [
    cargaResult.error,
    adminIdsResult.error,
    syncResult.error,
    syncHealthResult.error,
    notasMetricsResult.error,
    fluxoResult.error,
    produtividadeResult.error,
  ].find(Boolean)

  if (firstError) throw firstError

  const operationalAdminIds = new Set(
    ((adminIdsResult.data ?? []) as Array<{ id: string }>).map((admin) => admin.id)
  )
  const carga = ((cargaResult.data ?? []) as CargaAdministrador[])
    .filter((admin) => operationalAdminIds.has(admin.id))
  const notasMetrics = (notasMetricsResult.data ?? {}) as Partial<DashboardNotasMetricsRpc>
  const fluxoRows = (fluxoResult.data ?? []) as DashboardFluxoDiario90d[]
  const produtividadeRowsRaw = (produtividadeResult.data ?? []) as DashboardProdutividadePeriodoRpc[]
  const produtividadeRows: DashboardProdutividade60d[] = produtividadeRowsRaw.map((row) => ({
    administrador_id: row.administrador_id,
    nome: row.nome,
    avatar_url: resolveAvatarUrl({ name: row.nome, avatarUrl: row.avatar_url }),
    especialidade: row.especialidade as DashboardProdutividade60d['especialidade'],
    concluidas_30d: Number(row.concluidas_periodo ?? 0),
    concluidas_prev_30d: Number(row.concluidas_periodo_anterior ?? 0),
  }))
  const latestSync = ((syncResult.data ?? []) as SyncLog[])[0] ?? null
  const syncHealth = ((syncHealthResult.data ?? []) as SyncHealthRow[])[0] ?? null
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
  const alerts = buildAlerts({ summary, latestSync, syncHealth, now })
  const teamCapacityRows = buildTeamCapacityRows(carga)
  const productivityRows = buildProductivityRanking(produtividadeRows)

  return (
    <section className="space-y-4">
      <KpiStrip items={kpis} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ThroughputTrend data={throughput} spanDays={period.spanDays} periodLabel={period.periodLabel} />
        </div>
        <AlertsPanel alerts={alerts} latestSync={latestSync} syncHealth={syncHealth} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProductivityRanking rows={productivityRows} periodLabel={period.periodLabel} />
        </div>
        <TeamCapacity rows={teamCapacityRows} />
      </div>
    </section>
  )
}
