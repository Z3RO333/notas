// apps/web/src/lib/types/saidas.ts

export type SaidaOperacionalStatus = 'pendente_transferencia' | 'em_rota' | 'finalizada' | 'cancelada'
export type SaidaOrdemResultado = 'resolvida' | 'nao_resolvida' | 'reagendada'
export type RotaDispatchStatus = 'published' | 'accepted' | 'rejected' | 'cancelled'
export type RedistribuicaoOrdemStatus = 'pending' | 'processing' | 'failed' | 'completed' | 'cancelled'

export interface RotaDispatchSummary {
  id: string
  status: RotaDispatchStatus
  publishedAt: string
}

export interface OperacionalSaida {
  id: string
  operacionalCodigo: string
  operacionalNomeSnapshot: string
  criadoPorAdminId: string
  status: SaidaOperacionalStatus
  dataSaida: string
  dataFinalizacao: string | null
  observacao: string | null
  createdAt: string
  totalOrdens: number
}

export interface SaidaOrdem {
  id: string
  saidaId: string
  ordemCodigo: string
  numeroNota: string | null
  unidade: string | null
  textoBreve: string | null
  statusOrdemRawSnapshot: string | null
  tipoOrdem: string | null
  resultado: SaidaOrdemResultado | null
  observacaoRetorno: string | null
  dataResultado: string | null
  createdAt: string
}

export interface SaidaDetalhe extends OperacionalSaida {
  ordensComResultado: number
  ordens: SaidaOrdem[]
}

export interface CriarSaidaOrdemInput {
  ordem_codigo: string
  numero_nota: string | null
  unidade: string | null
  texto_breve: string | null
  status_ordem_raw_snapshot: string | null
  tipo_ordem: string | null
}

export interface RedistribuicaoOrdemResumo {
  id: string
  orderNumber: string
  sourceOperationalName: string
  targetOperationalName: string
  status: RedistribuicaoOrdemStatus
  motivo: string
  sapSyncStatus: 'not_requested' | 'pending' | 'synced' | 'failed'
  createdAt: string
  completedAt: string | null
}
