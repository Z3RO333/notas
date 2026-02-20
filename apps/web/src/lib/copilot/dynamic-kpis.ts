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
 * Saudável: Produtividade, Eficiência, Tendência de melhoria
 * Atenção:  Notas envelhecendo, Backlog atual, Taxa de resolução
 * Risco:    Notas críticas, Admins sobrecarregados, Ordens atrasadas
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
        tone: 'danger',
        pulse: true,
      },
      {
        id: 'notas_criticas',
        label: 'Notas críticas',
        value: formatInt(totalCriticas),
        tone: 'danger',
        pulse: totalCriticas > 0,
      },
      {
        id: 'admins_sobrecarregados',
        label: 'Sobrecarregados',
        value: formatInt(sobrecarregados),
        tone: sobrecarregados > 0 ? 'danger' : 'warning',
      },
      {
        id: 'ordens_vermelhas',
        label: 'Ordens atrasadas',
        value: formatInt(totalVermelhas),
        tone: totalVermelhas > 0 ? 'danger' : 'neutral',
      },
      {
        id: 'sem_atribuir',
        label: 'Sem atribuir',
        value: formatInt(summary.sem_atribuir),
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
        tone: 'warning',
      },
      {
        id: 'envelhecendo',
        label: 'Perto do SLA',
        value: formatInt(pertoSla),
        tone: pertoSla > 0 ? 'warning' : 'neutral',
        pulse: pertoSla > 5,
      },
      {
        id: 'abertas_agora',
        label: 'Abertas agora',
        value: formatInt(summary.abertas_agora),
        tone: summary.abertas_agora > 0 ? 'warning' : 'neutral',
      },
      {
        id: 'taxa_resolucao',
        label: 'Taxa de resolução',
        value: formatPct(summary.taxa_fechamento_30d),
        tone: summary.taxa_fechamento_30d >= 1 ? 'success' : 'warning',
      },
      {
        id: 'sem_atribuir',
        label: 'Sem atribuir',
        value: formatInt(summary.sem_atribuir),
        tone: summary.sem_atribuir > 0 ? 'danger' : 'success',
      },
    ]
  }

  // Saudavel — show growth metrics
  const totalConcluidas7d = radarRows.reduce((s, r) => s + r.concluidas_7d, 0)
  return [
    {
      id: 'iso_global',
      label: 'ISO Global',
      value: isoGlobal.iso_score.toFixed(0),
      tone: 'success',
    },
    {
      id: 'concluidas_7d',
      label: 'Concluídas (7d)',
      value: formatInt(totalConcluidas7d),
      tone: 'success',
    },
    {
      id: 'taxa_resolucao',
      label: 'Taxa de resolução',
      value: formatPct(summary.taxa_fechamento_30d),
      tone: summary.taxa_fechamento_30d >= 1 ? 'success' : 'neutral',
    },
    {
      id: 'abertas_agora',
      label: 'Abertas agora',
      value: formatInt(summary.abertas_agora),
      tone: 'neutral',
    },
    {
      id: 'dentro_prazo',
      label: 'Dentro do SLA',
      value: formatInt(agingCounts.dentro_prazo),
      tone: 'success',
    },
  ]
}
