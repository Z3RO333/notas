import { describe, expect, it } from 'vitest'
import { buildDynamicKpis } from '@/lib/copilot/dynamic-kpis'
import type { IsoGlobal, SmartAgingCounts, WorkloadRadarRow } from '@/lib/types/copilot'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'

const baseSummary: DashboardSummaryMetrics = {
  abertas_agora: 20,
  sem_atribuir: 0,
  aging_48h: 0,
  entradas_30d: 25,
  concluidas_30d: 20,
  notas_convertidas_30d: 4,
  taxa_nota_ordem_30d: 0.2,
  taxa_fechamento_30d: 1,
}

const baseCounts: SmartAgingCounts = {
  dentro_prazo: 15,
  perto_de_estourar: 3,
  estourado: 1,
  critico: 0,
}

const baseRow: WorkloadRadarRow = {
  administrador_id: 'a1',
  nome: 'Ana',
  avatar_url: null,
  especialidade: null,
  iso_score: 10,
  iso_faixa: 'saudavel',
  qtd_abertas: 5,
  max_notas: 20,
  pct_carga: 25,
  workload_status: 'equilibrado',
  qtd_notas_criticas: 0,
  qtd_ordens_vermelhas: 0,
  concluidas_7d: 3,
  concluidas_30d: 12,
  media_diaria_30d: 0.4,
  em_ferias: false,
  recebe_distribuicao: true,
}

describe('buildDynamicKpis', () => {
  it('contexto saudavel quando iso_score < 25', () => {
    const global: IsoGlobal = {
      iso_score: 10,
      iso_faixa: 'saudavel',
      total_admins: 1,
      total_abertas: 5,
      admins_criticos: 0,
    }

    const kpis = buildDynamicKpis({
      isoGlobal: global,
      summary: baseSummary,
      radarRows: [baseRow],
      agingCounts: baseCounts,
    })

    expect(kpis.some((item) => item.id === 'dentro_prazo')).toBe(true)
  })

  it('contexto atencao quando iso_score entre 25 e 50', () => {
    const global: IsoGlobal = {
      iso_score: 35,
      iso_faixa: 'atencao',
      total_admins: 1,
      total_abertas: 10,
      admins_criticos: 0,
    }

    const kpis = buildDynamicKpis({
      isoGlobal: global,
      summary: baseSummary,
      radarRows: [baseRow],
      agingCounts: baseCounts,
    })

    expect(kpis.some((item) => item.id === 'envelhecendo')).toBe(true)
  })

  it('contexto risco quando iso_score >= 50', () => {
    const global: IsoGlobal = {
      iso_score: 65,
      iso_faixa: 'risco_alto',
      total_admins: 1,
      total_abertas: 20,
      admins_criticos: 1,
    }

    const kpis = buildDynamicKpis({
      isoGlobal: global,
      summary: baseSummary,
      radarRows: [baseRow],
      agingCounts: baseCounts,
    })

    expect(kpis.some((item) => item.id === 'notas_criticas')).toBe(true)
  })

  it('sem_atribuir > 0 usa tone danger', () => {
    const global: IsoGlobal = {
      iso_score: 35,
      iso_faixa: 'atencao',
      total_admins: 1,
      total_abertas: 10,
      admins_criticos: 0,
    }

    const kpis = buildDynamicKpis({
      isoGlobal: global,
      summary: { ...baseSummary, sem_atribuir: 5 },
      radarRows: [baseRow],
      agingCounts: baseCounts,
    })

    const semAtribuir = kpis.find((item) => item.id === 'sem_atribuir')
    expect(semAtribuir?.tone).toBe('danger')
  })
})
