import type { Especialidade } from '@/lib/types/database'
import type { AdminPerson, PersonFormState, PmplAssignment } from '@/components/admin/admin-people-types'

export const ESPECIALIDADE_OPTIONS: Array<{ value: Especialidade; label: string }> = [
  { value: 'geral', label: 'Geral' },
  { value: 'refrigeracao', label: 'Refrigeração' },
  { value: 'elevadores', label: 'Elevadores' },
  { value: 'cd_manaus', label: 'CD Manaus' },
  { value: 'cd_manaus_equip', label: 'CD Manaus Equip' },
  { value: 'cd_taruma', label: 'CD Taruma' },
  { value: 'criticos', label: 'Gestão de Incêndio' },
]

export const EMPTY_PERSON_FORM: PersonFormState = {
  nome: '',
  email: '',
  role: 'admin',
  especialidade: 'geral',
  ativo: true,
  emFerias: false,
  dataInicioFerias: '',
  dataFimFerias: '',
  emailsAdicionais: [],
}

export function getEspecialidadeLabel(value: string): string {
  return ESPECIALIDADE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function toPersonFormState(person: AdminPerson): PersonFormState {
  return {
    id: person.id,
    nome: person.nome,
    email: person.email,
    role: person.role,
    especialidade: (person.especialidade as Especialidade) ?? 'geral',
    ativo: person.ativo,
    emFerias: person.em_ferias,
    dataInicioFerias: person.data_inicio_ferias ?? '',
    dataFimFerias: person.data_fim_ferias ?? '',
    emailsAdicionais: person.emailsAdicionais,
  }
}

export function resolvePmplAssignment(params: {
  personId: string
  pmplResponsavelId?: string | null
  pmplSubstitutoId?: string | null
}): PmplAssignment {
  const responsavelId = (params.pmplResponsavelId ?? '').trim()
  const substitutoId = (params.pmplSubstitutoId ?? '').trim()

  if (responsavelId && params.personId === responsavelId) return 'responsavel'
  if (substitutoId && params.personId === substitutoId) return 'substituto'
  return null
}

export function formatVacationPeriod(person: Pick<AdminPerson, 'data_inicio_ferias' | 'data_fim_ferias'>): string {
  if (!person.data_inicio_ferias && !person.data_fim_ferias) return '—'
  return `${person.data_inicio_ferias ?? '—'} até ${person.data_fim_ferias ?? '—'}`
}
