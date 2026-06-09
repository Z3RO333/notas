export interface OrdemConsulta {
  ordemId: string
  ordemCodigo: string
  numeroNota: string
  unidade: string | null
  statusOrdemRaw: string
  diasEmAberto: number
  semaforoAtraso: 'verde' | 'amarelo' | 'vermelho' | 'neutro'
  fornecedorCodigo: string | null
  fornecedorNome: string | null
  descricao: string | null
  responsavelNome: string | null
  responsavelEmail: string | null
  ordemDetectadaEm: string
  tipoOrdem: string | null
}

export interface ConsultasResponse {
  ordens: OrdemConsulta[]
  nextCursor: { detectada: string; id: string } | null
}
