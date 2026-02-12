// ==============================
// Copilot Inteligente — Types
// ==============================

// --- ISO (Indice de Severidade Operacional) ---

export type IsoFaixa = 'saudavel' | 'atencao' | 'risco_alto' | 'critico'

export interface IsoAdminRow {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  nota_severity: number
  order_severity: number
  workload_pressure: number
  critical_density: number
  iso_score: number
  iso_faixa: IsoFaixa
  qtd_abertas: number
  max_notas: number
  qtd_notas_criticas: number
  qtd_ordens_vermelhas: number
}

export interface IsoGlobal {
  iso_score: number
  iso_faixa: IsoFaixa
  total_admins: number
  total_abertas: number
  admins_criticos: number
}

// --- Smart Aging (SLA Categories) ---

export type SmartAgingCategory = 'dentro_prazo' | 'perto_de_estourar' | 'estourado' | 'critico'

export interface SmartAgingBadge {
  label: string
  category: SmartAgingCategory
  chip: string
  text: string
  pulse: boolean
}

export interface SmartAgingCounts {
  dentro_prazo: number
  perto_de_estourar: number
  estourado: number
  critico: number
}

// --- Copilot Alerts ---

export type CopilotAlertLevel = 'critical' | 'warning' | 'info'

export interface CopilotAlert {
  id: string
  level: CopilotAlertLevel
  title: string
  description: string
  adminId?: string
  adminNome?: string
  actionLabel?: string
  actionType?: CopilotActionType
}

// --- Workload Radar ---

export type WorkloadStatus = 'ocioso' | 'equilibrado' | 'carregado' | 'sobrecarregado'

export interface WorkloadRadarRow {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  iso_score: number
  iso_faixa: IsoFaixa
  qtd_abertas: number
  max_notas: number
  pct_carga: number
  workload_status: WorkloadStatus
  qtd_notas_criticas: number
  qtd_ordens_vermelhas: number
  concluidas_7d: number
  concluidas_30d: number
  media_diaria_30d: number
  em_ferias: boolean
  recebe_distribuicao: boolean
}

// --- Productivity ---

export type MedalType = 'ouro' | 'prata' | 'bronze' | null
export type TendenciaType = 'subindo' | 'estavel' | 'caindo'

export interface ProductivityDetailRow {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  concluidas_7d: number
  concluidas_30d: number
  concluidas_prev_30d: number
  media_diaria_30d: number
  variacao_pct: number
  eficiencia: number
  medal: MedalType
  tendencia: TendenciaType
}

// --- Predictions ---

export type PredictionSeverity = 'alta' | 'media' | 'baixa'
export type PredictionType =
  | 'capacidade_estouro'
  | 'aging_sla_estouro'
  | 'taxa_entrada_alta'
  | 'admin_limite'

export interface Prediction {
  tipo: PredictionType
  adminId?: string
  adminNome?: string
  diasParaEvento: number
  severidade: PredictionSeverity
  mensagem: string
}

// --- Suggestions ---

export type CopilotActionType =
  | 'redistribuir'
  | 'escalar'
  | 'pausar_distribuicao'
  | 'investigar_unidade'
  | 'redistribuir_ferias'

export type SuggestionPriority = 'alta' | 'media' | 'baixa'

export interface CopilotSuggestion {
  id: string
  prioridade: SuggestionPriority
  acao: CopilotActionType
  titulo: string
  descricao: string
  impacto: string
  adminId?: string
  adminNome?: string
  targetAdminId?: string
  targetAdminNome?: string
  notaIds?: string[]
  unidade?: string
}

// --- Dynamic KPIs ---

export type DynamicKpiContext = 'saudavel' | 'atencao' | 'risco'

export interface DynamicKpiItem {
  id: string
  label: string
  value: string
  helper: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  pulse?: boolean
}
