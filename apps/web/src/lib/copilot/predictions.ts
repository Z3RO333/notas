import type {
  Prediction,
  PredictionSeverity,
  WorkloadRadarRow,
} from '@/lib/types/copilot'
import type { DashboardThroughputPoint } from '@/lib/types/dashboard'

/**
 * Build predictions based on linear extrapolation of recent trends.
 *
 * 1. Taxa de entrada > saida → projetar dias ate estouro de capacidade global
 * 2. Admin individual prestes a atingir max_notas
 * 3. Aging medio crescente → projetar quando ultrapassa SLA
 */
export function buildPredictions(params: {
  throughput: DashboardThroughputPoint[]
  radarRows: WorkloadRadarRow[]
  capacidadeTotal: number
  abertasAgora: number
}): Prediction[] {
  const { throughput, radarRows, capacidadeTotal, abertasAgora } = params
  const predictions: Prediction[] = []

  // Use last 7 days of throughput for trend
  const recent7 = throughput.slice(-7)
  if (recent7.length >= 3) {
    const avgEntrada = recent7.reduce((s, r) => s + r.qtd_entradas, 0) / recent7.length
    const avgSaida = recent7.reduce((s, r) => s + r.qtd_concluidas, 0) / recent7.length
    const netDaily = avgEntrada - avgSaida

    // 1. Global capacity overflow prediction
    if (netDaily > 0 && capacidadeTotal > 0) {
      const remaining = capacidadeTotal - abertasAgora
      const daysToOverflow = remaining > 0 ? Math.ceil(remaining / netDaily) : 0

      if (daysToOverflow <= 14) {
        predictions.push({
          tipo: 'taxa_entrada_alta',
          diasParaEvento: daysToOverflow,
          severidade: daysToOverflow <= 3 ? 'alta' : daysToOverflow <= 7 ? 'media' : 'baixa',
          mensagem: daysToOverflow <= 0
            ? `Capacidade global ja excedida. Entrada diaria media: ${avgEntrada.toFixed(1)}, saida: ${avgSaida.toFixed(1)}.`
            : `Capacidade global sera excedida em ~${daysToOverflow} dia(s). Entrada: ${avgEntrada.toFixed(1)}/dia, saida: ${avgSaida.toFixed(1)}/dia.`,
        })
      }
    }
  }

  // 2. Individual admin approaching max_notas
  for (const row of radarRows) {
    if (row.max_notas <= 0 || row.em_ferias) continue

    const pct = row.qtd_abertas / row.max_notas
    if (pct >= 0.85) {
      // Estimate days to full based on recent completions
      const dailyNet = row.media_diaria_30d > 0
        ? 1 - row.media_diaria_30d // assume ~1 new note per day per admin
        : 0.5 // fallback assumption

      const remaining = row.max_notas - row.qtd_abertas
      const daysToFull = dailyNet > 0 ? Math.ceil(remaining / dailyNet) : 0

      if (daysToFull <= 7) {
        predictions.push({
          tipo: 'admin_limite',
          adminId: row.administrador_id,
          adminNome: row.nome,
          diasParaEvento: Math.max(daysToFull, 0),
          severidade: pct >= 0.95 ? 'alta' : 'media',
          mensagem: pct >= 1
            ? `${row.nome} ja esta no limite (${row.qtd_abertas}/${row.max_notas}).`
            : `${row.nome} atingira o limite em ~${Math.max(daysToFull, 1)} dia(s) (${row.qtd_abertas}/${row.max_notas}).`,
        })
      }
    }
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
        mensagem: `${row.nome} tem ${criticas} de ${total} notas com aging critico (3+ dias). Risco de SLA massivo.`,
      })
    } else if (ratioCriticas >= 0.3 && criticas >= 2) {
      predictions.push({
        tipo: 'aging_sla_estouro',
        adminId: row.administrador_id,
        adminNome: row.nome,
        diasParaEvento: 2,
        severidade: 'media',
        mensagem: `${row.nome} tem ${criticas} notas criticas. Sem acao, ${total - criticas} notas restantes podem estourar SLA em ~2 dias.`,
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
