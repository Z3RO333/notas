import { createClient } from '@/lib/supabase/server'
import { isVacationActive, resolveCurrentPmplOwner } from '@/lib/orders/pmpl-routing'
import type { PmplOwnerResolution } from '@/lib/orders/pmpl-routing'
import type { AdminPerson } from '@/components/admin/admin-people-types'

interface PmplConfigRow {
  responsavel_id: string | null
  substituto_id: string | null
}

interface AdministrationOwnerCandidate {
  id: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  ativo: boolean
}

export interface AdministrationPageData {
  people: AdminPerson[]
  configLoadError: string | null
  pmplConfig: PmplConfigRow | null
  pmplResolution: PmplOwnerResolution
  ownerCandidates: AdministrationOwnerCandidate[]
  configuredResponsavelNome: string | null
  configuredSubstitutoNome: string | null
  currentOwnerNome: string | null
  currentOwnerEmail: string | null
  currentOwnerStatus: string
  fallbackGestorNome: string | null
}

function isMissingVacationColumnsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return (error.message ?? '').toLowerCase().includes('data_inicio_ferias')
    || (error.message ?? '').toLowerCase().includes('data_fim_ferias')
}

async function loadAdminPeople(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AdminPerson[]> {
  const fullPeopleResult = await supabase
    .from('administradores')
    .select('id, nome, email, role, especialidade, ativo, em_ferias, data_inicio_ferias, data_fim_ferias')
    .order('nome', { ascending: true })

  if (fullPeopleResult.error && isMissingVacationColumnsError(fullPeopleResult.error)) {
    const legacyPeopleResult = await supabase
      .from('administradores')
      .select('id, nome, email, role, ativo, em_ferias')
      .order('nome', { ascending: true })

    if (legacyPeopleResult.error) throw legacyPeopleResult.error

    return (legacyPeopleResult.data ?? []).map((item) => ({
      ...(item as Omit<AdminPerson, 'especialidade' | 'data_inicio_ferias' | 'data_fim_ferias'>),
      especialidade: 'geral',
      data_inicio_ferias: null,
      data_fim_ferias: null,
    })) as AdminPerson[]
  }

  if (fullPeopleResult.error) throw fullPeopleResult.error
  return (fullPeopleResult.data ?? []) as AdminPerson[]
}

export async function loadAdministrationPageData(): Promise<AdministrationPageData> {
  const supabase = await createClient()
  const people = await loadAdminPeople(supabase)

  let configLoadError: string | null = null
  let pmplConfig: PmplConfigRow | null = null

  const { data: configData, error: configError } = await supabase
    .from('responsaveis_tipo_ordem')
    .select('responsavel_id, substituto_id')
    .eq('tipo_ordem', 'PMPL')
    .maybeSingle()

  if (configError && configError.code !== 'PGRST116') {
    configLoadError = (configError.code === '42P01' || configError.code === 'PGRST205')
      ? 'Tabela de configuracao PMPL ainda nao existe. Aplique as migrations 00043/00044.'
      : configError.message
  }

  if (!configError && configData) {
    pmplConfig = {
      responsavel_id: configData.responsavel_id ?? null,
      substituto_id: configData.substituto_id ?? null,
    }
  }

  const personById = new Map(people.map((person) => [person.id, person]))

  let pmplResolution: PmplOwnerResolution = {
    currentOwner: null,
    configuredResponsavel: null,
    configuredSubstituto: null,
    fallbackGestor: null,
    viewerAdminIds: [],
  }

  try {
    pmplResolution = await resolveCurrentPmplOwner(supabase)
  } catch (error) {
    configLoadError = configLoadError ?? (error instanceof Error ? error.message : 'Falha ao resolver responsavel PMPL')
  }

  const configuredResponsavel = pmplConfig?.responsavel_id ? personById.get(pmplConfig.responsavel_id) ?? null : null
  const configuredSubstituto = pmplConfig?.substituto_id ? personById.get(pmplConfig.substituto_id) ?? null : null
  const currentOwner = pmplResolution.currentOwner

  const ownerCandidates = people
    .filter((person) => person.ativo && (person.role === 'admin' || person.role === 'gestor'))
    .map((person) => ({
      id: person.id,
      nome: person.nome,
      email: person.email,
      role: person.role,
      ativo: person.ativo,
    }))

  return {
    people,
    configLoadError,
    pmplConfig,
    pmplResolution,
    ownerCandidates,
    configuredResponsavelNome: configuredResponsavel?.nome ?? null,
    configuredSubstitutoNome: configuredSubstituto?.nome ?? null,
    currentOwnerNome: currentOwner?.nome ?? null,
    currentOwnerEmail: currentOwner?.email ?? null,
    currentOwnerStatus: currentOwner ? (isVacationActive(currentOwner) ? 'Ferias' : 'Ativo') : 'Indisponivel',
    fallbackGestorNome: pmplResolution.fallbackGestor?.nome ?? null,
  }
}
