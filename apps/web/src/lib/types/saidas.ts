// apps/web/src/lib/types/saidas.ts

export type SaidaOperacionalStatus = 'em_rota' | 'finalizada' | 'cancelada'
export type SaidaOrdemResultado = 'resolvida' | 'nao_resolvida' | 'reagendada'

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
  ordensComResultado: number
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
