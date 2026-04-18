export type PedidoCompraStatus = 'em_aberto' | 'cancelado' | 'encerrado'

export interface PedidoCompra {
  id: string
  documento_compras: string
  administrador_id: string
  sap_codigo: string
  /** Código numérico SAP do fornecedor, ex: "0000012029" */
  fornecedor: string | null
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
  /** Código da filial/loja onde o serviço é prestado */
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
  mesExtracao: string | null
}

export interface PedidosWorkspaceResponse {
  rows: PedidoCompra[]
  kpis: PedidosKpis
  availableAdmins: { id: string; nome: string }[]
  availableMeses: string[]
}
