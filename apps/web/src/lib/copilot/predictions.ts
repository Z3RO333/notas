import type {
  Prediction,
  PredictionSeverity,
  WorkloadRadarRow,
} from '@/lib/types/copilot'
import type { DashboardThroughputPoint } from '@/lib/types/dashboard'

/**
 * Build predictions based on linear extrapolation of recent trends.
 *
 * 1. Taxa de entrada > saida → projetar crescimento do backlog
 * 2. Admin individual em sobrecarga recorrente
 * 3. Aging medio crescente → projetar quando ultrapassa SLA
 */
export function buildPredictions(params: {
  throughput: DashboardThroughputPoint[]
  radarRows: WorkloadRadarRow[]
}): Prediction[] {
  const { throughput, radarRows } = params
  const predictions: Prediction[] = []

  // Use last 7 days of throughput for trend
  const recent7 = throughput.slice(-7)
  if (recent7.length >= 3) {
    const avgEntrada = recent7.reduce((s, r) => s + r.qtd_entradas, 0) / recent7.length
    const avgSaida = recent7.reduce((s, r) => s + r.qtd_concluidas, 0) / recent7.length
    const netDaily = avgEntrada - avgSaida

    // 1. Backlog growth prediction
    if (netDaily > 0.5) {
      const daysToCriticalGrowth = Math.ceil(20 / netDaily)
      predictions.push({
        tipo: 'taxa_entrada_alta',
        diasParaEvento: Math.max(daysToCriticalGrowth, 1),
        severidade: daysToCriticalGrowth <= 3 ? 'alta' : daysToCriticalGrowth <= 7 ? 'media' : 'baixa',
        mensagem: `Backlog em crescimento (~${netDaily.toFixed(1)} nota(s)/dia). Entrada: ${avgEntrada.toFixed(1)}/dia, saida: ${avgSaida.toFixed(1)}/dia.`,
      })
    }
  }

  // 2. Individual admin overload trend
  for (const row of radarRows) {
    if (row.em_ferias) continue
    if (row.workload_status !== 'sobrecarregado' && row.workload_status !== 'carregado') continue

    const dailyResolution = Math.max(row.media_diaria_30d, 0)
    const daysToReduceBacklog = dailyResolution > 0
      ? Math.ceil(row.qtd_abertas / dailyResolution)
      : 0

    predictions.push({
      tipo: 'sobrecarga_continua',
      adminId: row.administrador_id,
      adminNome: row.nome,
      diasParaEvento: Math.max(Math.min(daysToReduceBacklog, 14), 1),
      severidade: row.workload_status === 'sobrecarregado' ? 'alta' : 'media',
      mensagem: `${row.nome} segue com carga elevada (${row.qtd_abertas} abertas, pressao ${row.pct_carga.toFixed(0)}%).`,
    })
  }

  // 3. SLA breach prediction — admins with many notes approaching critical
  for (const row of radarRows) {
    if (row.em_ferias || row.qtd_abertas === 0) continue

    const criticas = row.qtd_notas_criticas
    const total = row.qtd_abertas
    const ratioCriticas = criticas / total

    if (ratioCriticas >= 0.5 && criticas >= 3) {
      predictions.push({
        tipo: 'aging_sla_estouro',
        adminId: row.administrador_id,
        adminNome: row.nome,
        diasParaEvento: 0,
        severidade: 'alta',
        mensagem: `${row.nome} tem ${criticas} de ${total} notas com aging crítico (3+ dias). Risco de SLA massivo.`,
      })
    } else if (ratioCriticas >= 0.3 && criticas >= 2) {
      predictions.push({
        tipo: 'aging_sla_estouro',
        adminId: row.administrador_id,
        adminNome: row.nome,
        diasParaEvento: 2,
        severidade: 'media',
        mensagem: `${row.nome} tem ${criticas} notas críticas. Sem ação, ${total - criticas} notas restantes podem estourar SLA em ~2 dias.`,
      })
    }
  }

  // Sort by severity then by days
  const severityOrder: Record<PredictionSeverity, number> = { alta: 0, media: 1, baixa: 2 }
  return predictions.sort((a, b) => {
    const sevDiff = severityOrder[a.severidade] - severityOrder[b.severidade]
    if (sevDiff !== 0) return sevDiff
    return a.diasParaEvento - b.diasParaEvento
  })
}
