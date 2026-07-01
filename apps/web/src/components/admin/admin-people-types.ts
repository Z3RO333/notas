import type { Especialidade } from '@/lib/types/database'

export interface AdminPerson {
  id: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  especialidade: string
  ativo: boolean
  recebe_distribuicao: boolean
  em_ferias: boolean
  data_inicio_ferias: string | null
  data_fim_ferias: string | null
}

export interface PersonFormState {
  id?: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  especialidade: Especialidade
  ativo: boolean
  emFerias: boolean
  dataInicioFerias: string
  dataFimFerias: string
}

export interface AdminPeopleManagerProps {
  people: AdminPerson[]
  pmplResponsavelId?: string | null
  pmplSubstitutoId?: string | null
}

export type PmplAssignment = 'responsavel' | 'substituto' | null
