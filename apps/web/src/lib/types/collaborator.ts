import type { Especialidade } from './database'

export type NotesViewMode = 'list' | 'cards'
export type TrackingPositionMode = 'top' | 'inside' | 'both'

export interface CollaboratorData {
  id: string
  nome: string
  ativo: boolean
  max_notas: number
  avatar_url: string | null
  especialidade: Especialidade
  recebe_distribuicao: boolean
  em_ferias: boolean
  qtd_nova: number
  qtd_em_andamento: number
  qtd_encaminhada: number
  qtd_novo: number
  qtd_1_dia: number
  qtd_2_mais: number
  qtd_abertas: number
  qtd_concluidas: number
  qtd_acompanhamento_ordens: number
}
