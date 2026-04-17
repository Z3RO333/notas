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

export type UserRole = 'admin' | 'gestor' | 'viewer'
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
  denominacao_unidade: string | null
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

export interface NotaLookupResult {
  id: string
  numero_nota: string
  descricao: string | null
  status: NotaStatus
  administrador_id: string
  responsavel_nome: string
  prioridade: string | null
  centro: string | null
  denominacao_unidade: string | null
  data_criacao_sap: string | null
  created_at: string
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

export type NotesEmCampoHintPriority = 'interno' | 'externo' | 'equilibrado'
export type NotesEmCampoExternalMatchMode = 'exato' | 'fallback_servico'
export type NotesEmCampoSuggestionTargetType = 'operacional'

export interface NotesEmCampoOperationalSuggestion {
  fornecedor_codigo: string
  fornecedor_nome: string
  total_em_campo: number
  ordens_mesma_loja_ativas: number
  historico_loja_servico: number
  historico_servico_geral: number
  match_mode: NotesEmCampoExternalMatchMode | null
}

export interface NotesEmCampoHint {
  prioridade: NotesEmCampoHintPriority
  mensagem: string
}

export interface NotesEmCampoSuggestionTarget {
  tipo: NotesEmCampoSuggestionTargetType
  codigo: string | null
  nome: string
  ordens_mesma_loja_ativas: number
  historico_loja_servico: number
  historico_servico_geral: number
  match_mode: NotesEmCampoExternalMatchMode | null
}

export interface NotesEmCampoData {
  operacionais: NotesEmCampoOperationalSuggestion[]
  hint: NotesEmCampoHint
}

export interface NotesEmCampoNoteSuggestion {
  nota_id: string
  numero_nota: string
  loja: string | null
  servico: string | null
  destino_tipo: NotesEmCampoSuggestionTargetType | null
  destino_codigo: string | null
  destino_nome: string | null
  ordens_mesma_loja_ativas: number
  historico_loja_servico: number
  historico_servico_geral: number
  match_mode: NotesEmCampoExternalMatchMode | null
  mensagem_consolidacao: string | null
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

export type Especialidade = 'refrigeracao' | 'elevadores' | 'geral' | 'cd_manaus' | 'cd_taruma' | 'criticos'

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
  qtd_ordens_ativas?: number
  meta_semanal: number
  notas_recebidas_7d: number
  ordens_recebidas_7d: number
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
  aguardando_confirmacao_sync?: boolean
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

export interface OrdersPoolGroup {
  pool_nome: string
  pool_label: string
  total: number
  atrasadas: number
  atencao: number
  abertas: number
  rows: OrdemNotaAcompanhamento[]
}

export interface OrdersWorkspaceHighlights {
  oldest: OrdemNotaAcompanhamento[]
  attention: OrdemNotaAcompanhamento[]
}

export interface OrdersWorkspaceResponse {
  rows: OrdemNotaAcompanhamento[]
  pendingSyncRows?: OrdemNotaAcompanhamento[]
  nextCursor: OrdersWorkspaceCursor | null
  unitOptions: string[]
  kpis: OrdersWorkspaceKpis
  ownerSummary: OrdersOwnerSummary[]
  reassignTargets: OrderReassignTarget[]
  poolGroups: Array<Omit<OrdersPoolGroup, 'rows'>>
  poolCentros: Record<string, string>
  highlights?: OrdersWorkspaceHighlights
  currentUser: {
    role: UserRole
    adminId: string
    canViewGlobal: boolean
    canAccessPmpl: boolean
    maintainerViewActive?: boolean
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

export interface EscalaDistribuicaoSabado {
  id: string
  data_escala: string
  hora_fim: string
  atualizado_por: string | null
  created_at: string
  updated_at: string
}

export interface EscalaDistribuicaoSabadoParticipante {
  escala_id: string
  administrador_id: string
  created_at: string
}

export interface SaturdayDistributionScheduleEntryInput {
  data_escala: string
  hora_fim: string | null
  administrador_ids: string[]
}

export interface SaturdayDistributionScheduleMonthPayload {
  monthKey: string
  entries: SaturdayDistributionScheduleEntryInput[]
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
  'prioridade' | 'centro' | 'denominacao_unidade' | 'data_criacao_sap' | 'created_at'
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
  | 'tipo_ordem'
  | 'centro'
  | 'denominacao_unidade'
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
  tipo_ordem: string | null
  centro: string | null
  denominacao_unidade: string | null
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

export type FinanceiroTipoOrdem = 'PMOS' | 'PMPL'
export type FinanceiroReplaceMode = 'competencia' | 'upsert'

export interface FinanceiroImportRow {
  rowIndex: number
  ordem_codigo: string
  tipo_ordem: FinanceiroTipoOrdem | null
  numero_nota: string | null
  data_entrada: string | null
  inicio_programado: string | null
  denominacao_unidade: string | null
  texto_breve: string | null
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  custos_estimados: number | null
  custos_totais_materiais: number | null
  custos_adicionais: number | null
  custos_totais_reais: number | null
}

export interface FinanceiroImportError {
  linha: number
  ordem_codigo: string
  motivo: string
}

export interface FinanceiroImportScope {
  tipo_ordem: FinanceiroTipoOrdem
  competencia_inicio: string
  competencia_fim: string
}

export interface FinanceiroImportBatchResult {
  created: number
  updated: number
  deleted: number
  skipped: number
  scopes: FinanceiroImportScope[]
  missing_operational_count?: number
  missing_operational_order_codes?: string[]
  errors: FinanceiroImportError[]
}

export interface FinanceiroImportProgress {
  totalRows: number
  processedRows: number
  created: number
  updated: number
  deleted: number
  skipped: number
  scopes: FinanceiroImportScope[]
  missingOperationalCount?: number
  missingOperationalOrderCodes?: string[]
  errors: FinanceiroImportError[]
}

// --- Gráficos Gestão ---

export type TipoUnidade = 'LOJA' | 'FARMA' | 'CD'

export interface GestaoBaseOrdem {
  ordem_id: string
  ordem_codigo: string
  tipo_ordem: string
  competencia_data: string | null
  ano: number
  mes: number
  nome_loja: string | null
  tipo_unidade: TipoUnidade | null
  texto_breve: string | null
  status_ordem_raw: string | null
  nota_referencia: string | null
}

export interface DashboardGestaoRow {
  nome_loja: string | null
  centro: string | null
  texto_breve: string
  tipo_ordem: string | null
  tipo_unidade: TipoUnidade | null
  ano: number
  mes: number
  total_ordens: number
  total_notas: number
}

export interface GestaoSegmentoSummary {
  tipo: TipoUnidade
  label: string
  total_ordens: number
  total_notas: number
  unidades: number
  percentual_ordens: number
}

export interface GestaoTopLoja {
  nome_loja: string
  concluidas: number
  em_aberto: number
  total_ordens: number
}

export interface GestaoTopServico {
  texto_breve: string
  total_ordens: number
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

// --- Financeiro ---

export interface FinanceiroOrdemRow {
  id: string
  ordem_codigo: string
  tipo_ordem: FinanceiroTipoOrdem
  numero_nota: string | null
  data_entrada: string | null
  denominacao_unidade: string | null
  texto_breve: string | null
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  custos_estimados: number
  custos_totais_materiais: number
  custos_adicionais: number
  custos_totais_reais: number
  competencia_ano: number
  competencia_mes: number
  valor_realizado: number
  valor_previsto_pendente: number
  tem_custo_real: boolean
  valor_servico_calculado: number
  source_file_name: string | null
  imported_by: string | null
  importado_em: string
  created_at: string
  updated_at: string
}

export interface FinanceiroKpiSummary {
  tipo_ordem: FinanceiroTipoOrdem
  total_ordens: number
  ordens_com_custo_real: number
  custo_realizado: number
  custo_previsto_pendente: number
  ticket_medio_realizado: number
  cobertura_percentual: number
}

export interface FinanceiroEvolucaoMes {
  ano: number
  mes: number
  label: string
  realizado: number
  previsto_pendente: number
  total_gasto: number
  compromisso_total: number
}

export interface FinanceiroRankingRow {
  nome: string
  realizado: number
  previsto_pendente: number
  total_gasto: number
  compromisso_total: number
}

// --- Comparativos Anuais ---

export interface ComparativoOrdensMes {
  ano: number
  mes: number
  total_ordens: number
  ordens_abertas: number
  ordens_executadas: number
}

export interface ComparativoOrdensResumoAno {
  ano: number
  total_ordens: number
  ordens_abertas: number
  ordens_executadas: number
}

export interface ComparativoFinanceiroMes {
  ano: number
  mes: number
  total_ordens: number
  total_gasto: number
  valor_realizado: number
  valor_previsto_pendente: number
}

export interface ComparativoFinanceiroResumoAno {
  ano: number
  total_ordens: number
  total_gasto: number
  valor_realizado: number
  valor_previsto_pendente: number
}

export interface ComparativoFornecedorResumo {
  fornecedor_ref: string
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  ano: number
  total_ordens: number
  total_gasto: number
  valor_realizado: number
  valor_previsto_pendente: number
}

export interface ComparativoFornecedorMes {
  fornecedor_ref: string
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  ano: number
  mes: number
  total_ordens: number
  total_gasto: number
  valor_realizado: number
  valor_previsto_pendente: number
}

// ============================================================
// Operacional (Fornecedores)
// ============================================================

export interface OperacionalKpis {
  total_operacionais: number
  ordens_atendidas: number
  ordens_em_aberto: number
  lojas_atendidas: number
  total_ordens: number
}

export interface ProdutividadeOperacional {
  fornecedor_codigo: string
  fornecedor_nome: string | null
  total_ordens: number
  atendidas: number
  em_aberto: number
  lojas_atendidas: number
  pct_conclusao: number
}

export interface ServicoMaisFeito {
  texto_breve: string
  quantidade: number
  pct_total: number
}

export interface LojaPorOperacional {
  fornecedor_codigo: string
  unidade: string
  qtd_atendidas: number
}

export interface OrdensAbertasLoja {
  unidade: string
  total_abertas: number
}

export interface EvolucaoMensalOperacional {
  ano: number
  mes: number
  label: string
  concluidas: number
  em_aberto: number
}

export interface ProdutividadeLoja {
  unidade: string
  total_ordens: number
  atendidas: number
  em_aberto: number
  pct_conclusao: number
}
