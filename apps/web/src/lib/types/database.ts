// Tipos gerados manualmente baseados no schema do Supabase
// Em producao, use `npx supabase gen types typescript` para gerar automaticamente

export type NotaStatus =
  | 'nova'
  | 'em_andamento'
  | 'encaminhada_fornecedor'
  | 'concluida'
  | 'cancelada'

export type NotaStatusOperacional =
  | 'PENDENTE'
  | 'EM_GERACAO'
  | 'ALERTA'
  | 'CONFIRMADA_VIROU_ORDEM'

export type UserRole = 'admin' | 'gestor'
export type OrderWindowFilter = 30 | 90 | 180
export type OrderOwnerMode = 'atual' | 'origem'
export type PanelViewMode = 'list' | 'cards'
export type OrdersPeriodMode = 'month' | 'custom'
export type OrdersPeriodModeOperational = 'all' | 'year' | 'year_month' | 'month' | 'range'
export type NotesKpiFilter = 'notas' | 'novas' | 'um_dia' | 'dois_mais'
export type OrdersKpiFilter = 'total' | 'em_execucao' | 'em_aberto' | 'atrasadas' | 'em_avaliacao' | 'avaliadas' | 'concluidas'
export type CriticalityLevel = 'saudavel' | 'atencao' | 'critico'
export interface OrderReassignTarget {
  id: string
  nome: string
  avatar_url?: string | null
  especialidade?: Especialidade | null
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

export type CockpitEstadoOperacional =
  | 'COCKPIT_PENDENTE'
  | 'AGUARDANDO_CONVERGENCIA'
  | 'COM_ORDEM'
  | 'ENCERRADA_SEM_ORDEM'
  | 'CANCELADA'
  | 'ORDEM_SEM_NOTA'

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
  data_inicio_ferias?: string | null
  data_fim_ferias?: string | null
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

export interface NotaConvergenciaCockpit {
  numero_nota: string
  numero_nota_norm: string
  nota_id: string | null
  id: string | null
  ordem_sap: string | null
  ordem_gerada: string | null
  ordem_candidata: string | null
  ordem_candidata_norm: string | null
  status: NotaStatus | null
  estado_operacional: CockpitEstadoOperacional
  descricao: string | null
  centro: string | null
  administrador_id: string | null
  data_criacao_sap: string | null
  tem_qmel: boolean
  tem_pmpl: boolean
  tem_mestre: boolean
  status_elegivel: boolean
  tem_ordem_vinculada: boolean
  eligible_cockpit: boolean
  reason_not_eligible: string | null
  reason_codes: string[]
  sync_id: string | null
  source_updated_at: string | null
  created_at: string
  updated_at: string
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

export interface NotaOperacaoEstado {
  nota_id: string
  numero_nota: string
  status_operacional: NotaStatusOperacional
  em_geracao_por_admin_id: string | null
  em_geracao_por_email: string | null
  em_geracao_em: string | null
  ultima_copia_em: string | null
  ttl_minutos: number
  numero_ordem_confirmada: string | null
  confirmada_em: string | null
  created_at: string
  updated_at: string
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

export type Especialidade = 'refrigeracao' | 'elevadores' | 'geral' | 'cd_manaus' | 'cd_taruma'

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

export interface DashboardNotasMetricsRpc {
  abertas_periodo: number
  sem_atribuir_periodo: number
  aging_48h_periodo: number
  qtd_notas_criadas_periodo: number
  qtd_notas_convertidas_periodo: number
  qtd_concluidas_periodo: number
  taxa_nota_ordem_periodo: number
  taxa_fechamento_periodo: number
}

export interface DashboardProdutividadePeriodoRpc {
  administrador_id: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  concluidas_periodo: number
  concluidas_periodo_anterior: number
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
  tipo_ordem: string | null
}

export interface OrderOwnerGroup {
  id: string
  nome: string
  avatar_url: string | null
  especialidade?: Especialidade | null
  rows: OrdemNotaAcompanhamento[]
  recentes: number
  atencao: number
  atrasadas: number
  abertas: number
  total: number
}

export interface OrdemKpisRpc {
  total: number
  abertas: number
  em_tratativa: number
  em_avaliacao: number
  concluidas: number
  canceladas: number
  avaliadas: number
  atrasadas_7d: number
  sem_responsavel: number
}

export interface OrdersWorkspaceFilters {
  periodMode: OrdersPeriodModeOperational
  year: number | null
  month: number | null
  startDate: string | null
  endDate: string | null
  q: string
  status: string
  responsavel: string
  unidade: string
  prioridade: string
  tipoOrdem: string
}

export interface OrdersWorkspaceCursor {
  ordem_detectada_em: string
  ordem_id: string
}

export interface OrdersOwnerSummary {
  administrador_id: string | null
  nome: string
  avatar_url: string | null
  total: number
  abertas: number
  recentes: number
  atencao: number
  atrasadas: number
}

export interface OrdersWorkspaceKpis {
  total: number
  abertas: number
  em_tratativa: number
  em_avaliacao: number
  concluidas: number
  canceladas: number
  avaliadas: number
  atrasadas: number
  sem_responsavel: number
}

export interface OrdersWorkspaceResponse {
  rows: OrdemNotaAcompanhamento[]
  nextCursor: OrdersWorkspaceCursor | null
  kpis: OrdersWorkspaceKpis
  ownerSummary: OrdersOwnerSummary[]
  reassignTargets: OrderReassignTarget[]
  currentUser: {
    role: UserRole
    adminId: string
    canViewGlobal: boolean
    canAccessPmpl: boolean
  }
}

export interface ResponsavelTipoOrdem {
  tipo_ordem: 'PMPL' | 'PMOS'
  responsavel_id: string
  substituto_id: string | null
  atualizado_por: string | null
  created_at: string
  updated_at: string
}

export interface AuditoriaConfig {
  id: string
  tipo: string
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
  atualizado_por: string | null
  updated_at: string
}

export interface OrderTimelineEvent {
  id: string
  origem: 'ordem' | 'nota'
  created_at: string
  titulo: string
  descricao: string
}

export interface OrderDetailDrawerData {
  ordem: OrdemNotaAcompanhamento
  descricao_nota: string | null
  envolvidos: Array<{ id: string; nome: string }>
  timeline: OrderTimelineEvent[]
}

export interface GridSortState {
  field: string
  direction: 'asc' | 'desc'
}

export interface GridFilterState {
  q?: string
  status?: string
  responsavel?: string
  unidade?: string
}

export interface GridPaginationState {
  page: number
  pageSize: number
  total: number
}

export interface SavedUserViewPreferences {
  density: 'compact' | 'comfortable'
  hiddenColumns: string[]
  ownerMode?: OrderOwnerMode
  panelViewMode?: PanelViewMode
  autoRefreshSec: number
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
  qtd_em_avaliacao_30d: number
  qtd_concluidas_30d: number
  qtd_canceladas_30d: number
  qtd_avaliadas_30d: number
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
> & {
  status_operacional?: NotaStatusOperacional | null
  em_geracao_por_admin_id?: string | null
  em_geracao_por_email?: string | null
  em_geracao_em?: string | null
  ultima_copia_em?: string | null
  ttl_minutos?: number | null
  numero_ordem_confirmada?: string | null
  confirmada_em?: string | null
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

// ============================================================
// Spreadsheet Import Types
// ============================================================

export type ImportSystemField =
  | 'ordem_codigo'
  | 'numero_nota'
  | 'status_ordem_raw'
  | 'centro'
  | 'ordem_detectada_em'

export type ImportMode =
  | 'create_and_update'
  | 'create_only'
  | 'update_only'
  | 'skip_existing'

export type RawSpreadsheetRow = Record<string, string>

export interface MappedImportRow {
  rowIndex: number
  ordem_codigo: string
  numero_nota: string | null
  status_ordem_raw: string | null
  centro: string | null
  ordem_detectada_em: string | null
}

export interface ImportRowError {
  linha: number
  ordem_codigo: string
  motivo: string
}

export interface ImportBatchResult {
  created: number
  updated: number
  skipped: number
  errors: ImportRowError[]
}

export interface ImportProgress {
  totalRows: number
  processedRows: number
  created: number
  updated: number
  skipped: number
  errors: ImportRowError[]
}

// --- Gráficos Gestão ---

export interface DashboardGestaoRow {
  nome_loja: string | null
  centro: string | null
  texto_breve: string
  tipo_ordem: string | null
  ano: number
  mes: number
  total_ordens: number
  total_notas: number
}

export interface GestaoTopLoja {
  nome_loja: string
  total_ordens: number
}

export interface GestaoTopServico {
  texto_breve: string
  total_notas: number
  percentual: number
}

export interface GestaoRecorrencia {
  nome_loja: string
  texto_breve: string
  total_notas: number
}

export interface GestaoEvolucaoMes {
  ano: number
  mes: number
  label: string
  total_ordens: number
  total_notas: number
}

export interface GestaoKpis {
  total_ordens: number
  total_notas: number
  lojas_ativas: number
  servicos_unicos: number
}
