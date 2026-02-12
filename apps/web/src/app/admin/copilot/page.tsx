import { createClient } from '@/lib/supabase/server'
import { IsoGauge } from '@/components/copilot/iso-gauge'
import { DynamicKpiStrip } from '@/components/copilot/dynamic-kpi-strip'
import { CopilotAlertsPanel } from '@/components/copilot/copilot-alerts-panel'
import { SuggestionsPanel } from '@/components/copilot/suggestions-panel'
import { PredictionsPanel } from '@/components/copilot/predictions-panel'
import { WorkloadRadar } from '@/components/copilot/workload-radar'
import { ProductivityMedals } from '@/components/copilot/productivity-medals'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { buildCopilotAlerts } from '@/lib/copilot/alerts'
import { buildSmartAgingCounts } from '@/lib/copilot/aging'
import { buildDynamicKpis } from '@/lib/copilot/dynamic-kpis'
import { buildPredictions } from '@/lib/copilot/predictions'
import { buildSuggestions } from '@/lib/copilot/suggestions'
import { buildProductivityDetailRows } from '@/lib/copilot/productivity'
import { sortRadarRows } from '@/lib/copilot/workload'
import { getIsoFaixa, getIsoFaixaConfig } from '@/lib/copilot/iso'
import {
  buildDashboardSummary,
  buildThroughput30d,
  type OpenNotaAgingRow,
} from '@/lib/dashboard/metrics'
import type {
  CargaAdministrador,
  DashboardFluxoDiario90d,
  NotaPanelData,
  OrdemNotaAcompanhamento,
  SyncLog,
} from '@/lib/types/database'
import type {
  IsoAdminRow,
  IsoGlobal,
  WorkloadRadarRow,
  IsoFaixa,
} from '@/lib/types/copilot'

export const dynamic = 'force-dynamic'

const OPEN_STATUSES = ['nova', 'em_andamento', 'encaminhada_fornecedor'] as const
const OPEN_NOTAS_FIELDS = 'data_criacao_sap, created_at, status' as const
const NOTA_PANEL_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const

export default async function CopilotPage() {
  const supabase = await createClient()

  // Parallel data fetching
  const [
    isoAdminsResult,
    isoGlobalResult,
    radarResult,
    prodResult,
    cargaResult,
    fluxoResult,
    openNotasResult,
    notasPanelResult,
    syncResult,
    unassignedResult,
    ordensResult,
  ] = await Promise.all([
    supabase.from('vw_iso_por_admin').select('*').order('iso_score', { ascending: false }),
    supabase.from('vw_iso_global').select('*').single(),
    supabase.from('vw_radar_colaborador').select('*').order('iso_score', { ascending: false }),
    supabase.from('vw_produtividade_detalhada').select('*').order('concluidas_30d', { ascending: false }),
    supabase.from('vw_carga_administradores').select('*').order('nome'),
    supabase.from('vw_dashboard_fluxo_diario_90d').select('*').order('dia', { ascending: true }),
    supabase.from('notas_manutencao').select(OPEN_NOTAS_FIELDS).in('status', OPEN_STATUSES),
    supabase
      .from('notas_manutencao')
      .select(NOTA_PANEL_FIELDS)
      .in('status', OPEN_STATUSES),
    supabase.from('sync_log').select('*').order('started_at', { ascending: false }).limit(1),
    supabase
      .from('notas_manutencao')
      .select('id', { count: 'exact', head: true })
      .is('administrador_id', null)
      .eq('status', 'nova'),
    supabase
      .from('vw_ordens_notas_painel')
      .select('*')
      .not('status_ordem', 'in', '("concluida","cancelada")')
      .order('dias_em_aberto', { ascending: false })
      .limit(500),
  ])

  const now = new Date()
  const isoAdmins = (isoAdminsResult.data ?? []) as IsoAdminRow[]
  const isoGlobalRow = isoGlobalResult.data as IsoGlobal | null
  const isoGlobal: IsoGlobal = isoGlobalRow ?? {
    iso_score: 0,
    iso_faixa: 'saudavel' as IsoFaixa,
    total_admins: 0,
    total_abertas: 0,
    admins_criticos: 0,
  }
  const radarRows = sortRadarRows((radarResult.data ?? []) as WorkloadRadarRow[])
  const carga = (cargaResult.data ?? []) as CargaAdministrador[]
  const fluxoRows = (fluxoResult.data ?? []) as DashboardFluxoDiario90d[]
  const openNotas = (openNotasResult.data ?? []) as OpenNotaAgingRow[]
  const notasPanel = (notasPanelResult.data ?? []) as NotaPanelData[]
  const ordensRows = (ordensResult.data ?? []) as OrdemNotaAcompanhamento[]
  const latestSync = ((syncResult.data ?? []) as SyncLog[])[0] ?? null
  const notasSemAtribuir = unassignedResult.count ?? 0

  // Build dashboard summary for KPIs
  const throughput30d = buildThroughput30d(fluxoRows, now)
  const summary = buildDashboardSummary({
    carga,
    notasSemAtribuir,
    notasAbertas: openNotas,
    throughput30d,
    now,
  })

  // Smart aging counts
  const agingCounts = buildSmartAgingCounts(notasPanel, now)
  const notasCriticas5d = agingCounts.critico

  // Copilot alerts
  const alerts = buildCopilotAlerts({
    isoGlobal,
    isoAdmins,
    summary,
    latestSync,
    notasCriticas5d,
    now,
  })

  // Dynamic KPIs
  const dynamicKpis = buildDynamicKpis({
    isoGlobal,
    summary,
    radarRows,
    agingCounts,
  })

  // Predictions
  const capacidadeTotal = carga.reduce((s, c) => s + c.max_notas, 0)
  const abertasAgora = carga.reduce((s, c) => s + c.qtd_abertas, 0)
  const predictions = buildPredictions({
    throughput: throughput30d,
    radarRows,
    capacidadeTotal,
    abertasAgora,
  })

  // Suggestions
  const ordensVermelhasPorUnidade = new Map<string, number>()
  for (const o of ordensRows) {
    if (o.semaforo_atraso === 'vermelho' && o.unidade) {
      ordensVermelhasPorUnidade.set(o.unidade, (ordensVermelhasPorUnidade.get(o.unidade) ?? 0) + 1)
    }
  }
  const suggestions = buildSuggestions({
    radarRows,
    isoAdmins,
    notasSemAtribuir,
    ordensVermelhasPorUnidade,
  })

  // Productivity
  const productivityRows = buildProductivityDetailRows(
    (prodResult.data ?? []).map((r: Record<string, unknown>) => ({
      administrador_id: r.administrador_id as string,
      nome: r.nome as string,
      avatar_url: r.avatar_url as string | null,
      especialidade: r.especialidade as string | null,
      concluidas_7d: Number(r.concluidas_7d) || 0,
      concluidas_30d: Number(r.concluidas_30d) || 0,
      concluidas_prev_30d: Number(r.concluidas_prev_30d) || 0,
      media_diaria_30d: Number(r.media_diaria_30d) || 0,
      variacao_pct: Number(r.variacao_pct) || 0,
      eficiencia: Number(r.eficiencia) || 0,
    }))
  )

  // ISO faixa config for page background
  const faixaConfig = getIsoFaixaConfig(isoGlobal.iso_faixa as IsoFaixa)

  return (
    <div className="space-y-6">
      {/* Header with ISO Gauge */}
      <div className={`rounded-xl border p-6 ${faixaConfig.bg} ${faixaConfig.border}`}>
        <div className="flex flex-col items-center gap-4 md:flex-row md:items-start md:gap-8">
          <IsoGauge
            score={isoGlobal.iso_score}
            faixa={isoGlobal.iso_faixa as IsoFaixa}
            size="lg"
            label="ISO Operacional"
          />
          <div className="flex-1 text-center md:text-left">
            <h1 className="text-2xl font-bold tracking-tight">Copilot de Operacoes</h1>
            <p className="text-sm text-muted-foreground mt-1">
              O que voce precisa resolver hoje — visao inteligente da operacao.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3 justify-center md:justify-start">
              <span className="text-sm">
                <strong>{isoGlobal.total_admins}</strong> colaboradores
              </span>
              <span className="text-sm">
                <strong>{isoGlobal.total_abertas}</strong> notas abertas
              </span>
              {isoGlobal.admins_criticos > 0 && (
                <span className="text-sm text-red-600 font-medium">
                  {isoGlobal.admins_criticos} em estado critico
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic KPIs */}
      <DynamicKpiStrip items={dynamicKpis} />

      {/* Main grid: Alerts + Suggestions */}
      <div className="grid gap-6 xl:grid-cols-2">
        <CopilotAlertsPanel alerts={alerts} />
        <SuggestionsPanel suggestions={suggestions} maxItems={5} />
      </div>

      {/* Predictions */}
      <PredictionsPanel predictions={predictions} />

      {/* Team Radar */}
      <WorkloadRadar rows={radarRows} />

      {/* Productivity */}
      <ProductivityMedals rows={productivityRows} />

      <RealtimeListener />
    </div>
  )
}
