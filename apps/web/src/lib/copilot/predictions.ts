import type {
  Prediction,
  PredictionConfianca,
  PredictionSeverity,
  PredictionTendencia,
  WorkloadRadarRow,
} from '@/lib/types/copilot'
import type { DashboardThroughputPoint } from '@/lib/types/dashboard'

function confiancaFromPoints(n: number): PredictionConfianca {
  if (n >= 7) return 'alta'
  if (n >= 4) return 'media'
  return 'baixa'
}

function tendenciaFromWindow(current: number, previous: number | null): PredictionTendencia {
  if (previous === null) return 'estavel'
  if (current > previous + 0.5) return 'piorando'
  if (current < previous - 0.5) return 'melhorando'
  return 'estavel'
}

function variacaoPct(current: number, previous: number | null): number | undefined {
  if (previous === null || previous === 0) return undefined
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * Build predictions based on recent operational trends.
 *
 * 1. Taxa de entrada > saida -> projecao de crescimento do backlog
 * 2. Admin individual em sobrecarga recorrente -> tendencia
 * 3. Aging critico concentrado -> alerta antecipado
 */
export function buildPredictions(params: {
  throughput: DashboardThroughputPoint[]
  radarRows: WorkloadRadarRow[]
}): Prediction[] {
  const { throughput, radarRows } = params
  const predictions: Prediction[] = []

  const recent7 = throughput.slice(-7)
  const prior7 = throughput.slice(-14, -7)

  if (recent7.length >= 3) {
    const avgEntrada = recent7.reduce((sum, row) => sum + row.qtd_entradas, 0) / recent7.length
    const avgSaida = recent7.reduce((sum, row) => sum + row.qtd_concluidas, 0) / recent7.length
    const netDaily = avgEntrada - avgSaida

    const prevNetDaily = prior7.length >= 3
      ? (prior7.reduce((sum, row) => sum + row.qtd_entradas, 0) / prior7.length)
        - (prior7.reduce((sum, row) => sum + row.qtd_concluidas, 0) / prior7.length)
      : null

    if (netDaily > 0.5) {
      const daysToCriticalGrowth = Math.ceil(20 / netDaily)
      predictions.push({
        tipo: 'taxa_entrada_alta',
        diasParaEvento: Math.max(daysToCriticalGrowth, 1),
        severidade: daysToCriticalGrowth <= 3 ? 'alta' : daysToCriticalGrowth <= 7 ? 'media' : 'baixa',
        mensagem: `Backlog em crescimento (~${netDaily.toFixed(1)} nota(s)/dia). Entrada: ${avgEntrada.toFixed(1)}/dia, saida: ${avgSaida.toFixed(1)}/dia.`,
        kind: 'projecao',
        confianca: confiancaFromPoints(recent7.length),
        tendencia: tendenciaFromWindow(netDaily, prevNetDaily),
        variacaoPct: variacaoPct(netDaily, prevNetDaily),
      })
    }
  }

  for (const row of radarRows) {
    if (row.em_ferias) continue
    if (row.workload_status !== 'sobrecarregado' && row.workload_status !== 'carregado') continue

    const dailyResolution = Math.max(row.media_diaria_30d, 0)
    const daysToReduceBacklog = dailyResolution > 0
      ? Math.ceil(row.qtd_abertas / dailyResolution)
      : 0
    const isOverThreshold = row.workload_status === 'sobrecarregado'

    predictions.push({
      tipo: 'sobrecarga_continua',
      adminId: row.administrador_id,
      adminNome: row.nome,
      diasParaEvento: Math.max(Math.min(daysToReduceBacklog, 14), 1),
      severidade: isOverThreshold ? 'alta' : 'media',
      mensagem: `${row.nome} segue com carga elevada (${row.qtd_abertas} abertas, pressao ${row.pct_carga.toFixed(0)}%).`,
      kind: 'tendencia',
      confianca: row.media_diaria_30d > 0 ? 'media' : 'baixa',
      tendencia: isOverThreshold ? 'piorando' : 'estavel',
    })
  }

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
        mensagem: `${row.nome} tem ${criticas} de ${total} notas com aging critico (5+ dias). Risco de SLA massivo.`,
        kind: 'alerta_antecipado',
        confianca: 'alta',
        tendencia: 'piorando',
      })
      continue
    }

    if (ratioCriticas >= 0.3 && criticas >= 2) {
      predictions.push({
        tipo: 'aging_sla_estouro',
        adminId: row.administrador_id,
        adminNome: row.nome,
        diasParaEvento: 2,
        severidade: 'media',
        mensagem: `${row.nome} tem ${criticas} notas criticas. Sem acao, ${total - criticas} notas restantes podem estourar SLA em ~2 dias.`,
        kind: 'alerta_antecipado',
        confianca: 'media',
        tendencia: 'piorando',
      })
    }
  }

  const severityOrder: Record<PredictionSeverity, number> = { alta: 0, media: 1, baixa: 2 }
  return predictions.sort((left, right) => {
    const sevDiff = severityOrder[left.severidade] - severityOrder[right.severidade]
    if (sevDiff !== 0) return sevDiff
    return left.diasParaEvento - right.diasParaEvento
  })
}
