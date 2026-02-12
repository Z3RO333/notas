import type {
  DynamicKpiContext,
  DynamicKpiItem,
  IsoGlobal,
  WorkloadRadarRow,
  SmartAgingCounts,
} from '@/lib/types/copilot'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'

function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n)
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function getContext(isoScore: number): DynamicKpiContext {
  if (isoScore >= 50) return 'risco'
  if (isoScore >= 25) return 'atencao'
  return 'saudavel'
}

/**
 * Build dynamic KPI cards that change based on operational context.
 *
 * Saudavel: Produtividade, Eficiencia, Tendencia de melhoria
 * Atencao:  Notas envelhecendo, Capacidade, Taxa de resolucao
 * Risco:    Notas criticas, Admins sobrecarregados, Predicao de estouro
 */
export function buildDynamicKpis(params: {
  isoGlobal: IsoGlobal
  summary: DashboardSummaryMetrics
  radarRows: WorkloadRadarRow[]
  agingCounts: SmartAgingCounts
}): DynamicKpiItem[] {
  const { isoGlobal, summary, radarRows, agingCounts } = params
  const ctx = getContext(isoGlobal.iso_score)

  if (ctx === 'risco') {
    const sobrecarregados = radarRows.filter((r) => r.workload_status === 'sobrecarregado').length
    const totalCriticas = radarRows.reduce((s, r) => s + r.qtd_notas_criticas, 0)
    const totalVermelhas = radarRows.reduce((s, r) => s + r.qtd_ordens_vermelhas, 0)

    return [
      {
        id: 'iso_global',
        label: 'ISO Global',
        value: isoGlobal.iso_score.toFixed(0),
        helper: `${isoGlobal.admins_criticos} admin(s) em estado critico`,
        tone: 'danger',
        pulse: true,
      },
      {
        id: 'notas_criticas',
        label: 'Notas criticas',
        value: formatInt(totalCriticas),
        helper: 'Notas com 3+ dias sem resolucao',
        tone: 'danger',
        pulse: totalCriticas > 0,
      },
      {
        id: 'admins_sobrecarregados',
        label: 'Sobrecarregados',
        value: formatInt(sobrecarregados),
        helper: `De ${radarRows.length} colaboradores ativos`,
        tone: sobrecarregados > 0 ? 'danger' : 'warning',
      },
      {
        id: 'ordens_vermelhas',
        label: 'Ordens atrasadas',
        value: formatInt(totalVermelhas),
        helper: 'Ordens com 7+ dias em aberto',
        tone: totalVermelhas > 0 ? 'danger' : 'neutral',
      },
      {
        id: 'sem_atribuir',
        label: 'Sem atribuir',
        value: formatInt(summary.sem_atribuir),
        helper: 'Notas aguardando distribuicao',
        tone: summary.sem_atribuir > 0 ? 'danger' : 'success',
      },
    ]
  }

  if (ctx === 'atencao') {
    const pertoSla = agingCounts.perto_de_estourar + agingCounts.estourado
    return [
      {
        id: 'iso_global',
        label: 'ISO Global',
        value: isoGlobal.iso_score.toFixed(0),
        helper: 'Operacao requer atencao',
        tone: 'warning',
      },
      {
        id: 'envelhecendo',
        label: 'Perto do SLA',
        value: formatInt(pertoSla),
        helper: 'Notas em 2-4 dias de aging',
        tone: pertoSla > 0 ? 'warning' : 'neutral',
        pulse: pertoSla > 5,
      },
      {
        id: 'utilizacao',
        label: 'Capacidade',
        value: formatPct(summary.utilizacao_capacidade),
        helper: `${formatInt(summary.abertas_agora)} abertas / ${formatInt(summary.capacidade_total)} total`,
        tone: summary.utilizacao_capacidade >= 0.85 ? 'warning' : 'neutral',
      },
      {
        id: 'taxa_resolucao',
        label: 'Taxa de resolucao',
        value: formatPct(summary.taxa_fechamento_30d),
        helper: 'Concluidas / entradas (30d)',
        tone: summary.taxa_fechamento_30d >= 1 ? 'success' : 'warning',
      },
      {
        id: 'sem_atribuir',
        label: 'Sem atribuir',
        value: formatInt(summary.sem_atribuir),
        helper: 'Notas aguardando distribuicao',
        tone: summary.sem_atribuir > 0 ? 'danger' : 'success',
      },
    ]
  }

  // Saudavel — show growth metrics
  const totalConcluidas7d = radarRows.reduce((s, r) => s + r.concluidas_7d, 0)
  const mediaDiaria = radarRows.reduce((s, r) => s + r.media_diaria_30d, 0)
  return [
    {
      id: 'iso_global',
      label: 'ISO Global',
      value: isoGlobal.iso_score.toFixed(0),
      helper: 'Operacao saudavel',
      tone: 'success',
    },
    {
      id: 'concluidas_7d',
      label: 'Concluidas (7d)',
      value: formatInt(totalConcluidas7d),
      helper: `Media diaria: ${mediaDiaria.toFixed(1)}`,
      tone: 'success',
    },
    {
      id: 'taxa_resolucao',
      label: 'Taxa de resolucao',
      value: formatPct(summary.taxa_fechamento_30d),
      helper: `${formatInt(summary.concluidas_30d)} concl. / ${formatInt(summary.entradas_30d)} entradas`,
      tone: summary.taxa_fechamento_30d >= 1 ? 'success' : 'neutral',
    },
    {
      id: 'utilizacao',
      label: 'Capacidade',
      value: formatPct(summary.utilizacao_capacidade),
      helper: 'Equilibrada e sob controle',
      tone: 'neutral',
    },
    {
      id: 'dentro_prazo',
      label: 'Dentro do SLA',
      value: formatInt(agingCounts.dentro_prazo),
      helper: 'Notas em 0-1 dia de aging',
      tone: 'success',
    },
  ]
}
