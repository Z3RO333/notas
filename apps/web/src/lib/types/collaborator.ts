import type { Especialidade } from './database'

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
  qtd_abertas: number
  qtd_concluidas: number
}
