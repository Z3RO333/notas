export interface KpisNotasOrdens {
  total_notas: number
  notas_convertidas: number
  taxa_conversao: number
  tempo_medio_nota_ordem: number | null
  tempo_medio_conclusao: number | null
  total_ordens_concluidas: number
}

export interface ResumoDiarioRow {
  data_ref: string   // DATE retornado como string pelo Supabase JS client
  notas_entradas: number
  viraram_ordem: number
  ordens_concluidas: number
}

export interface LojaIndicadoresRow {
  unidade: string
  total_notas: number
  total_ordens: number
  taxa_conversao: number
}

export interface ColaboradorIndicadoresRow {
  administrador_id: string
  nome: string
  total_notas: number
  notas_convertidas: number
  taxa_conversao: number
  tempo_medio_nota_ordem: number | null
}
