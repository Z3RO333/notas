import type { Especialidade } from '@/lib/types/database'

export type DashboardKpiId =
  | 'abertas_agora'
  | 'sem_atribuir'
  | 'aging_48h'
  | 'taxa_nota_ordem_30d'
  | 'taxa_fechamento_30d'

export type DashboardTone = 'neutral' | 'success' | 'warning' | 'danger'
export type DashboardAlertLevel = 'critical' | 'warning' | 'info'

export interface DashboardSummaryMetrics {
  abertas_agora: number
  sem_atribuir: number
  aging_48h: number
  entradas_30d: number
  concluidas_30d: number
  notas_convertidas_30d: number
  taxa_nota_ordem_30d: number
  taxa_fechamento_30d: number
}

export interface DashboardKpiItem {
  id: DashboardKpiId
  label: string
  value: string
  helper?: string
  tone: DashboardTone
}

export interface DashboardThroughputPoint {
  dia: string
  label: string
  qtd_entradas: number
  qtd_concluidas: number
}

export interface DashboardTeamCapacityRow {
  especialidade: Especialidade
  label: string
  admins: number
  abertas: number
  media_abertas: number
}

export interface DashboardProductivityRow {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: Especialidade
  concluidas_30d: number
  concluidas_prev_30d: number
  variacao_30d: number
}

export interface DashboardAlert {
  id: string
  level: DashboardAlertLevel
  title: string
  description: string
}
