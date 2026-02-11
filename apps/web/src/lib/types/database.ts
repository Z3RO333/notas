// Tipos gerados manualmente baseados no schema do Supabase
// Em producao, use `npx supabase gen types typescript` para gerar automaticamente

export type NotaStatus =
  | 'nova'
  | 'em_andamento'
  | 'encaminhada_fornecedor'
  | 'concluida'
  | 'cancelada'

export type UserRole = 'admin' | 'gestor'

export interface Administrador {
  id: string
  auth_user_id: string
  nome: string
  email: string
  role: UserRole
  ativo: boolean
  max_notas: number
  avatar_url: string | null
  especialidade: string | null
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
