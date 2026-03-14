import { describe, expect, it } from 'vitest'
import { buildPredictions } from '@/lib/copilot/predictions'
import type { WorkloadRadarRow } from '@/lib/types/copilot'
import type { DashboardThroughputPoint } from '@/lib/types/dashboard'

function makePoint(qtdEntradas: number, qtdConcluidas: number): DashboardThroughputPoint {
  return {
    dia: new Date().toISOString().slice(0, 10),
    label: 'Hoje',
    qtd_entradas: qtdEntradas,
    qtd_concluidas: qtdConcluidas,
  }
}

function makePoints(entradas: number, concluidas: number, count = 7): DashboardThroughputPoint[] {
  return Array.from({ length: count }, () => makePoint(entradas, concluidas))
}

function makeRadar(overrides: Partial<WorkloadRadarRow> = {}): WorkloadRadarRow {
  return {
    administrador_id: 'a1',
    nome: 'Admin',
    avatar_url: null,
    especialidade: null,
    iso_score: 20,
    iso_faixa: 'atencao',
    qtd_abertas: 10,
    max_notas: 20,
    pct_carga: 50,
    workload_status: 'equilibrado',
    qtd_notas_criticas: 0,
    qtd_ordens_vermelhas: 0,
    concluidas_7d: 5,
    concluidas_30d: 20,
    media_diaria_30d: 0.67,
    em_ferias: false,
    recebe_distribuicao: true,
    ...overrides,
  }
}

describe('buildPredictions', () => {
  it('retorna vazio sem dados relevantes', () => {
    const result = buildPredictions({ throughput: [], radarRows: [] })
    expect(result).toHaveLength(0)
  })

  describe('Predicao 1 - taxa_entrada_alta', () => {
    it('gera quando netDaily > 0.5', () => {
      const points = makePoints(5, 3)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      expect(result.some((prediction) => prediction.tipo === 'taxa_entrada_alta')).toBe(true)
    })

    it('marca kind como projecao', () => {
      const points = makePoints(5, 3)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.kind).toBe('projecao')
    })

    it('nao gera quando entradas <= saidas', () => {
      const points = makePoints(3, 5)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      expect(result.some((prediction) => prediction.tipo === 'taxa_entrada_alta')).toBe(false)
    })

    it('severidade alta quando diasParaEvento <= 3', () => {
      const points = makePoints(15, 5)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.severidade).toBe('alta')
    })

    it('confianca alta quando 7+ pontos', () => {
      const points = makePoints(5, 3, 7)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.confianca).toBe('alta')
    })

    it('confianca media quando 4-6 pontos', () => {
      const points = makePoints(5, 3, 5)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.confianca).toBe('media')
    })

    it('tendencia piorando quando netDaily cresceu vs janela anterior', () => {
      const prior = makePoints(4, 3, 7)
      const recent = makePoints(6, 3, 7)
      const result = buildPredictions({ throughput: [...prior, ...recent], radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.tendencia).toBe('piorando')
    })

    it('tendencia melhorando quando netDaily caiu vs janela anterior', () => {
      const prior = makePoints(8, 3, 7)
      const recent = makePoints(4, 3, 7)
      const result = buildPredictions({ throughput: [...prior, ...recent], radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.tendencia).toBe('melhorando')
    })

    it('variacaoPct preenchido quando ha janela anterior', () => {
      const prior = makePoints(4, 3, 7)
      const recent = makePoints(6, 3, 7)
      const result = buildPredictions({ throughput: [...prior, ...recent], radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.variacaoPct).toBeDefined()
    })

    it('variacaoPct undefined quando sem janela anterior', () => {
      const points = makePoints(5, 3, 5)
      const result = buildPredictions({ throughput: points, radarRows: [] })
      const prediction = result.find((item) => item.tipo === 'taxa_entrada_alta')
      expect(prediction?.variacaoPct).toBeUndefined()
    })
  })

  describe('Predicao 2 - sobrecarga_continua', () => {
    it('gera para admin sobrecarregado', () => {
      const radar = makeRadar({ workload_status: 'sobrecarregado', pct_carga: 115, qtd_abertas: 25 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      expect(result.some((prediction) => prediction.tipo === 'sobrecarga_continua')).toBe(true)
    })

    it('marca kind como tendencia', () => {
      const radar = makeRadar({ workload_status: 'sobrecarregado', pct_carga: 115, qtd_abertas: 25 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'sobrecarga_continua')
      expect(prediction?.kind).toBe('tendencia')
    })

    it('gera para admin carregado com severidade media', () => {
      const radar = makeRadar({ workload_status: 'carregado', pct_carga: 85, qtd_abertas: 17 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'sobrecarga_continua')
      expect(prediction?.severidade).toBe('media')
    })

    it('severidade alta para sobrecarregado', () => {
      const radar = makeRadar({ workload_status: 'sobrecarregado', pct_carga: 115 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'sobrecarga_continua')
      expect(prediction?.severidade).toBe('alta')
    })

    it('nao gera para admin equilibrado', () => {
      const radar = makeRadar({ workload_status: 'equilibrado' })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      expect(result.some((prediction) => prediction.tipo === 'sobrecarga_continua')).toBe(false)
    })

    it('nao gera para admin em ferias', () => {
      const radar = makeRadar({ workload_status: 'sobrecarregado', em_ferias: true })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      expect(result.some((prediction) => prediction.tipo === 'sobrecarga_continua')).toBe(false)
    })

    it('tendencia piorando quando sobrecarregado', () => {
      const radar = makeRadar({ workload_status: 'sobrecarregado' })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'sobrecarga_continua')
      expect(prediction?.tendencia).toBe('piorando')
    })
  })

  describe('Predicao 3 - aging_sla_estouro', () => {
    it('gera alta quando ratio >= 50% e criticas >= 3', () => {
      const radar = makeRadar({ qtd_abertas: 6, qtd_notas_criticas: 4 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'aging_sla_estouro')
      expect(prediction?.severidade).toBe('alta')
    })

    it('marca kind como alerta_antecipado', () => {
      const radar = makeRadar({ qtd_abertas: 6, qtd_notas_criticas: 4 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'aging_sla_estouro')
      expect(prediction?.kind).toBe('alerta_antecipado')
    })

    it('gera media quando ratio >= 30% e criticas >= 2', () => {
      const radar = makeRadar({ qtd_abertas: 10, qtd_notas_criticas: 3 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'aging_sla_estouro')
      expect(prediction?.severidade).toBe('media')
    })

    it('nao gera quando ratio < 30%', () => {
      const radar = makeRadar({ qtd_abertas: 20, qtd_notas_criticas: 2 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      expect(result.some((prediction) => prediction.tipo === 'aging_sla_estouro')).toBe(false)
    })

    it('tendencia sempre piorando para SLA estouro', () => {
      const radar = makeRadar({ qtd_abertas: 6, qtd_notas_criticas: 4 })
      const result = buildPredictions({ throughput: [], radarRows: [radar] })
      const prediction = result.find((item) => item.tipo === 'aging_sla_estouro')
      expect(prediction?.tendencia).toBe('piorando')
    })

    it('usa a contagem real do painel para SLA quando o radar vier inflado', () => {
      const radar = makeRadar({ administrador_id: 'a1', qtd_abertas: 57, qtd_notas_criticas: 50 })
      const result = buildPredictions({
        throughput: [],
        radarRows: [radar],
        adminNoteStats: new Map([
          ['a1', {
            administrador_id: 'a1',
            qtd_abertas: 18,
            qtd_notas_criticas: 14,
            critical_density: 77.8,
          }],
        ]),
      })
      const prediction = result.find((item) => item.tipo === 'aging_sla_estouro')
      expect(prediction?.mensagem).toContain('14 de 18')
    })
  })

  describe('Ordenacao', () => {
    it('alta antes de media', () => {
      const radar = makeRadar({ qtd_abertas: 6, qtd_notas_criticas: 4, workload_status: 'carregado', pct_carga: 80 })
      const points = makePoints(4, 5)
      const result = buildPredictions({ throughput: points, radarRows: [radar] })
      const firstMedia = result.findIndex((prediction) => prediction.severidade === 'media')
      const lastAlta = result.map((prediction) => prediction.severidade).lastIndexOf('alta')
      if (firstMedia !== -1 && lastAlta !== -1) {
        expect(lastAlta).toBeLessThan(firstMedia)
      }
    })
  })
})
