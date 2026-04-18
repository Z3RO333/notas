export type PedidoCompraStatus = 'em_aberto' | 'cancelado' | 'encerrado'

export interface PedidoCompra {
  id: string
  documento_compras: string
  administrador_id: string
  sap_codigo: string
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
}

export interface PedidosKpis {
  total: number
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
}

export interface PedidosWorkspaceFilters {
  q: string
  status: PedidoCompraStatus | 'all'
  adminId: string | 'all'
  anoExtracao: string | null
  mesExtracao: string | null
}

export interface PedidosWorkspaceResponse {
  rows: PedidoCompra[]
  kpis: PedidosKpis
  availableAdmins: { id: string; nome: string }[]
  availableAnos: string[]
  availableMeses: string[]
}
