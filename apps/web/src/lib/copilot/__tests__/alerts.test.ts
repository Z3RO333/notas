import { describe, expect, it } from 'vitest'
import { buildCopilotAlerts } from '@/lib/copilot/alerts'
import type { IsoGlobal, IsoAdminRow } from '@/lib/types/copilot'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'

const baseGlobal: IsoGlobal = {
  iso_score: 10, iso_faixa: 'saudavel', total_admins: 3, total_abertas: 20, admins_criticos: 0,
}
const baseSummary: DashboardSummaryMetrics = {
  abertas_agora: 20, sem_atribuir: 0, aging_48h: 0,
  entradas_30d: 30, concluidas_30d: 28, notas_convertidas_30d: 5,
  taxa_nota_ordem_30d: 0.17, taxa_fechamento_30d: 0.93,
}
const baseAdmin: IsoAdminRow = {
  administrador_id: 'a1', nome: 'Ana', avatar_url: null, especialidade: null,
  nota_severity: 10, order_severity: 0, workload_pressure: 40, critical_density: 0,
  iso_score: 10, iso_faixa: 'saudavel', qtd_abertas: 8, max_notas: 20,
  qtd_notas_criticas: 0, qtd_ordens_vermelhas: 0,
}

const recentSync = {
  id: 's1', status: 'success' as const,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  notas_processadas: 10, notas_criadas: 2, notas_atualizadas: 8, erro: null,
}

describe('buildCopilotAlerts', () => {
  it('retorna saudavel quando sem alertas', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: baseGlobal, isoAdmins: [], summary: baseSummary,
      latestSync: recentSync as never, notasCriticas: 0,
    })
    expect(alerts.some(a => a.id === 'saudavel')).toBe(true)
  })

  it('gera alerta critico quando iso_faixa = critico', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: { ...baseGlobal, iso_faixa: 'critico', iso_score: 80 },
      isoAdmins: [], summary: baseSummary, latestSync: null, notasCriticas: 0,
    })
    expect(alerts.some(a => a.id === 'iso-critico')).toBe(true)
  })

  it('gera alerta warning quando iso_faixa = risco_alto', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: { ...baseGlobal, iso_faixa: 'risco_alto', iso_score: 55 },
      isoAdmins: [], summary: baseSummary, latestSync: null, notasCriticas: 0,
    })
    expect(alerts.some(a => a.id === 'iso-risco')).toBe(true)
  })

  it('gera alerta de notas criticas quando notasCriticas > 0', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: baseGlobal, isoAdmins: [], summary: baseSummary,
      latestSync: null, notasCriticas: 5,
    })
    expect(alerts.some(a => a.id === 'notas-estourado-sla')).toBe(true)
  })

  it('alerta notas-estourado-sla tem viewHref', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: baseGlobal, isoAdmins: [], summary: baseSummary,
      latestSync: null, notasCriticas: 3,
    })
    const alert = alerts.find(a => a.id === 'notas-estourado-sla')
    expect(alert?.viewHref).toBe('/?kpi=critico')
  })

  it('alerta sem-atribuir tem viewHref', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: baseGlobal, isoAdmins: [],
      summary: { ...baseSummary, sem_atribuir: 3 },
      latestSync: null, notasCriticas: 0,
    })
    const alert = alerts.find(a => a.id === 'sem-atribuir')
    expect(alert?.viewHref).toContain('sem_atribuir')
  })

  it('admin sobrecarregado gera viewHref com responsavel', () => {
    const overloaded: IsoAdminRow = { ...baseAdmin, iso_score: 80, iso_faixa: 'critico' }
    const alerts = buildCopilotAlerts({
      isoGlobal: baseGlobal, isoAdmins: [overloaded], summary: baseSummary,
      latestSync: null, notasCriticas: 0,
    })
    const alert = alerts.find(a => a.id === 'admin-sobrecarregado-a1')
    expect(alert?.viewHref).toContain('a1')
  })

  it('não repete saudavel quando há outros alertas', () => {
    const alerts = buildCopilotAlerts({
      isoGlobal: baseGlobal, isoAdmins: [],
      summary: { ...baseSummary, sem_atribuir: 1 },
      latestSync: null, notasCriticas: 0,
    })
    expect(alerts.filter(a => a.id === 'saudavel').length).toBe(0)
  })
})
