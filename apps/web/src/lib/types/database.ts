// Tipos gerados manualmente baseados no schema do Supabase
// Em producao, use `npx supabase gen types typescript` para gerar automaticamente

export type NotaStatus =
  | 'nova'
  | 'em_andamento'
  | 'encaminhada_fornecedor'
  | 'concluida'
  | 'cancelada'

export type UserRole = 'admin' | 'gestor'
export type OrderWindowFilter = 30 | 90 | 180
export type OrderOwnerMode = 'atual' | 'origem'
export interface OrderReassignTarget {
  id: string
  nome: string
}

export interface OrderBulkReassignResult {
  nota_id: string
  administrador_destino_id: string
}

export type OrdemStatusAcomp =
  | 'aberta'
  | 'em_tratativa'
  | 'concluida'
  | 'cancelada'
  | 'desconhecido'

export interface Administrador {
  id: string
  auth_user_id: string | null
  nome: string
  email: string
  role: UserRole
  ativo: boolean
  max_notas: number
  avatar_url: string | null
  especialidade: string | null
  recebe_distribuicao: boolean
  em_ferias: boolean
  motivo_bloqueio: string | null
  created_at: string
  updated_at: string
}

export interface NotaManutencao {
  id: string
  numero_nota: string
  tipo_nota: string | null
  descricao: string
  descricao_objeto: string | null
  prioridade: string | null
  tipo_prioridade: string | null
  criado_por_sap: string | null
  solicitante: string | null
  data_criacao_sap: string | null
  data_nota: string | null
  hora_nota: string | null
  ordem_sap: string | null
  centro: string | null
  status_sap: string | null
  conta_fornecedor: string | null
  autor_nota: string | null
  streaming_timestamp: string | null
  status: NotaStatus
  administrador_id: string | null
  distribuida_em: string | null
  ordem_gerada: string | null
  fornecedor_encaminhado: string | null
  observacoes: string | null
  sync_id: string | null
  raw_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
  // Joined data
  administradores?: { nome: string; email: string } | null
}

export interface NotaHistorico {
  id: string
  nota_id: string
  campo_alterado: string
  valor_anterior: string | null
  valor_novo: string | null
  alterado_por: string | null
  motivo: string | null
  created_at: string
  // Joined
  administradores?: { nome: string } | null
}

export interface SyncLog {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  notas_lidas: number
  notas_inseridas: number
  notas_atualizadas: number
  notas_distribuidas: number
  erro_mensagem: string | null
  databricks_job_id: string | null
  metadata: Record<string, unknown> | null
}

export type Especialidade = 'refrigeracao' | 'elevadores' | 'geral'

export interface CargaAdministrador {
  id: string
  nome: string
  email: string
  ativo: boolean
  max_notas: number
  avatar_url: string | null
  especialidade: Especialidade
  recebe_distribuicao: boolean
  em_ferias: boolean
  qtd_nova: number
  qtd_em_andamento: number
  qtd_encaminhada: number
  qtd_abertas: number
  qtd_concluidas: number
  qtd_canceladas: number
}

export interface ProdutividadeMensal {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: Especialidade
  mes: string
  qtd_concluidas: number
}

export interface DashboardFluxoDiario90d {
  dia: string
  qtd_entradas: number
  qtd_concluidas: number
}

export interface DashboardProdutividade60d {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: Especialidade | null
  concluidas_30d: number
  concluidas_prev_30d: number
}

export interface OrdemAcompanhamento {
  acompanhamento_id: string
  nota_id: string
  administrador_id: string
  administrador_nome: string | null
  responsavel_atual_id: string | null
  responsavel_atual_nome: string | null
  numero_nota: string
  descricao: string
  status: NotaStatus
  ordem_gerada: string
  data_criacao_sap: string | null
  created_at: string
  acompanhamento_em: string
}

export interface OrdemNotaAcompanhamento {
  ordem_id: string
  nota_id: string
  numero_nota: string
  ordem_codigo: string
  administrador_id: string | null
  administrador_nome: string | null
  responsavel_atual_id: string | null
  responsavel_atual_nome: string | null
  centro: string | null
  unidade: string | null
  status_ordem: OrdemStatusAcomp
  status_ordem_raw: string | null
  ordem_detectada_em: string
  status_atualizado_em: string | null
  dias_para_gerar_ordem: number | null
  qtd_historico: number
  tem_historico: boolean
  dias_em_aberto: number
  semaforo_atraso: 'verde' | 'amarelo' | 'vermelho' | 'neutro'
  envolvidos_admin_ids: string[] | null
  descricao: string | null
}

export interface OrderOwnerGroup {
  id: string
  nome: string
  rows: OrdemNotaAcompanhamento[]
  recentes: number
  atencao: number
  atrasadas: number
  total: number
}

export interface OrdemNotaHistorico {
  id: string
  ordem_id: string
  status_anterior: OrdemStatusAcomp | null
  status_novo: OrdemStatusAcomp
  status_raw: string | null
  origem: string
  sync_id: string | null
  created_at: string
}

export interface OrdemNotaKpis {
  total_ordens_30d: number
  qtd_abertas_30d: number
  qtd_em_tratativa_30d: number
  qtd_concluidas_30d: number
  qtd_canceladas_30d: number
  qtd_antigas_7d_30d: number
  tempo_medio_geracao_dias_30d: number | null
}

export interface OrdemNotaRankingAdmin {
  administrador_id: string
  nome: string
  qtd_ordens_30d: number
  qtd_abertas_30d: number
  qtd_em_tratativa_30d: number
  qtd_concluidas_30d: number
  qtd_canceladas_30d: number
  qtd_antigas_7d_30d: number
  tempo_medio_geracao_dias_30d: number | null
}

export interface OrdemNotaRankingUnidade {
  unidade: string
  qtd_ordens_30d: number
  qtd_abertas_30d: number
  qtd_em_tratativa_30d: number
  qtd_antigas_7d_30d: number
  tempo_medio_geracao_dias_30d: number | null
}

export interface NotasMetrics30d {
  qtd_notas_criadas_30d: number
  qtd_notas_viraram_ordem_30d: number
  tempo_medio_para_ordem_dias_30d: number | null
  qtd_pendentes_sem_ordem: number
}

export interface PerspectivaReatribuicaoAdmin30d {
  administrador_id: string
  nome: string
  qtd_enviadas_30d: number
  qtd_recebidas_30d: number
  qtd_ordens_acompanhando_abertas: number
}

// Campos minimos que NotaCard e CollaboratorPanel precisam
export type NotaPanelData = Pick<NotaManutencao,
  'id' | 'numero_nota' | 'descricao' | 'status' | 'administrador_id' |
  'prioridade' | 'centro' | 'data_criacao_sap' | 'created_at'
>

export interface NotaResumo {
  id: string
  numero_nota: string
  descricao: string
  status: NotaStatus
  administrador_id: string
  distribuida_em: string | null
  updated_at: string
  data_criacao_sap: string | null
}

export interface DistribuicaoLog {
  id: string
  nota_id: string
  administrador_id: string
  notas_abertas_no_momento: number
  sync_id: string | null
  created_at: string
}

export interface AdminAuditLog {
  id: string
  gestor_id: string
  acao: string
  alvo_id: string | null
  detalhes: Record<string, unknown> | null
  created_at: string
  // Joined
  gestor?: { nome: string } | null
  alvo?: { nome: string } | null
}
