export type PedidoCompraStatus = 'em_aberto' | 'cancelado' | 'encerrado'
export type PedidoCompraStatusEfetivo = PedidoCompraStatus | 'indeterminado'

export type PedidosAttributionMode = 'responsavel_atual' | 'criador' | 'carteira_fornecedor'

export interface PedidosScopeMeta {
  grupoCompradores: '112'
  periodField: 'data_documento'
  attributionMode: PedidosAttributionMode
}

export interface PedidosFreshnessMeta {
  asOf: string | null
  syncedAt: string | null
  stale: boolean | null
}

export interface PedidosQualityMeta {
  indeterminados: number
  semItens: number
  semCriadorMapeado: number
  semResponsavel: number
  statusDesconhecido: number
  legadoNaoValidado: number
}

export interface PedidosContractMeta {
  scope: PedidosScopeMeta
  freshness: PedidosFreshnessMeta
  quality: PedidosQualityMeta
}

export interface PedidoCompra {
  id: string
  documento_compras: string
  /** Compatibilidade: representa o responsavel operacional atual. */
  administrador_id: string | null
  sap_codigo: string
  grupo_compradores?: string | null
  status_header?: string | null
  status_proc_raw?: string | null
  status_efetivo?: PedidoCompraStatusEfetivo
  status_indeterminado?: boolean
  organizacao_compras?: string | null
  data_criacao?: string | null
  criador_admin_id?: string | null
  criador_admin_nome?: string | null
  responsavel_atual_id?: string | null
  responsavel_atual_nome?: string | null
  source_bk_extracao?: string | null
  source_data_extracao?: string | null
  source_last_seen_at?: string | null
  source_active?: boolean
  scope_quality?: string | null
  status_quality?: string | null
  items_quality?: string | null
  /** Codigo numerico normalizado do fornecedor SAP, ex: "12029" */
  fornecedor: string | null
  fornecedor_codigo?: string | null
  fornecedor_nome?: string | null
  data_documento: string | null
  valor_liquido_total: number | null
  status: PedidoCompraStatus
  tipo_documento: string | null
  /** Formato YYYYMM, ex: "202501" */
  mes_extracao: string
  created_at: string
  updated_at: string
  nf_referencias: string[]
  fornecedor_owner_admin_id?: string | null
  fornecedor_owner_nome?: string | null
  na_carteira_especial?: boolean
  itens_total?: number
  itens_ativos?: number
  itens_excluidos?: number
  valor_itens_total?: number | null
  valor_itens_ativos?: number | null
  valor_divergencia?: number | null
}

export interface PedidoCompraItem {
  id: string
  documento_compras: string
  item_numero: string
  descricao: string | null
  codigo_material: string | null
  grupo_mercadoria: string | null
  quantidade: number | null
  unidade_medida: string | null
  preco_unitario: number | null
  valor_liquido: number | null
  /** Codigo da filial/loja onde o servico e prestado */
  centro: string | null
  requisicao_compra: string | null
  excluido?: boolean
}

export interface PedidosKpis {
  total: number
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
  indeterminado?: number
  valor_em_aberto?: number
  valor_itens_ativos?: number
  fornecedores_em_aberto?: number
  abertos_mais_30_dias?: number
  abertos_mais_90_dias?: number
  sem_responsavel?: number
  status_indeterminado?: number
  legado_nao_validado?: number
  ultima_atualizacao?: string | null
}

export interface PedidosWorkspaceFilters {
  q: string
  status: PedidoCompraStatusEfetivo | 'all'
  adminId: string | 'all'
  /** Nome legado no frontend; o backend usa a competencia de data_documento. */
  anoExtracao: string | null
  /** Nome legado no frontend; o backend usa a competencia de data_documento. */
  mesExtracao: string | null
}

export interface PedidosWorkspaceCursor {
  cursorDate: string
  cursorId: string
}

export interface PedidosWorkspaceMeta {
  kpis: PedidosKpis
  availableAdmins: { id: string; nome: string; avatar_url: string | null }[]
  availableAnos: string[]
  availableMeses: string[]
  contract?: PedidosContractMeta
}

export interface PedidosFiltrosResponse {
  availableAnos: string[]
  availableMeses: string[]
  kpis: PedidosKpis
  contract?: PedidosContractMeta
}

export interface PedidosWorkspaceResponse {
  rows: PedidoCompra[]
  nextCursor: PedidosWorkspaceCursor | null
  meta?: PedidosWorkspaceMeta
}

export interface PedidosAdminSummary {
  adminId: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
  indeterminado?: number
  valor_em_aberto?: number
  criadorAdminId?: string | null
  responsavelAtualId?: string | null
  carteiraOwnerAdminId?: string | null
}

export interface PedidosSummaryResponse {
  admins: PedidosAdminSummary[]
  contract?: PedidosContractMeta
}

export type PedidosCarteiraTipo = 'corretiva' | 'preventiva_anual'

export interface PedidoContratoAnual {
  numero: string
  ciclo: string | null
  admin_id: string | null
  admin_nome: string | null
  admin_avatar: string | null
}

export interface PedidosCarteiraFornecedorRow {
  fornecedorCodigo: string
  fornecedorNome: string
  tipoCarteira: PedidosCarteiraTipo
  adminId: string
  adminNome: string | null
  adminAvatar: string | null
  qtdPedidos: number
  emAberto: number
  encerrado: number
  cancelado: number
  valorTotal: number
  documentosCompras: string[]
  pedidosContratos: PedidoContratoAnual[]
}

export interface PedidosCarteiraKpis {
  totalFornecedores: number
  totalPedidos: number
  valorTotal: number
  emAberto: number
  encerrado: number
  cancelado: number
}

export interface PedidosCarteiraResumo {
  rows: PedidosCarteiraFornecedorRow[]
  kpis: PedidosCarteiraKpis
}

export interface PedidosCarteiraResponse extends PedidosCarteiraResumo {
  availableAdmins: { id: string; nome: string; avatar_url: string | null }[]
  contract?: PedidosContractMeta
}
