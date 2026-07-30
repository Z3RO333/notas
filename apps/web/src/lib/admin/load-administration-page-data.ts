import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildSaturdayScheduleSlots,
  getSaturdayScheduleMonthWindow,
  mergeSaturdayScheduleRows,
  normalizeSaturdayScheduleMonthKey,
  type SaturdayScheduleCandidate,
  type SaturdayScheduleSlot,
} from '@/lib/admin/saturday-distribution-schedule'
import { isVacationActive, resolveCurrentPmplOwner } from '@/lib/orders/pmpl-routing'
import type { PmplOwnerResolution } from '@/lib/orders/pmpl-routing'
import { PMPL_FALLBACK_OWNER_EMAIL } from '@/lib/admin/admin-identity-catalog'
import type { AdminPerson } from '@/components/admin/admin-people-types'
import type {
  EscalaDistribuicaoSabado,
  EscalaDistribuicaoSabadoParticipante,
  OperacionalAdmin,
  OperacionalUnidade,
} from '@/lib/types/database'

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

type SaturdayScheduleRow = Pick<EscalaDistribuicaoSabado, 'id' | 'data_escala' | 'hora_fim'>
type SaturdayScheduleParticipantRow = Pick<EscalaDistribuicaoSabadoParticipante, 'escala_id' | 'administrador_id'>

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
  saturdayScheduleMonthKey: string
  saturdayScheduleCandidates: SaturdayScheduleCandidate[]
  saturdayScheduleSlots: SaturdayScheduleSlot[]
  operacionais: OperacionalAdmin[]
  todasUnidades: string[]
}

function isMissingVacationColumnsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return (error.message ?? '').toLowerCase().includes('data_inicio_ferias')
    || (error.message ?? '').toLowerCase().includes('data_fim_ferias')
}

async function loadAdminPeople(supabase: ReturnType<typeof createAdminClient>): Promise<AdminPerson[]> {
  const fullPeopleResult = await supabase
    .from('administradores')
    .select('id, nome, email, role, especialidade, ativo, recebe_distribuicao, em_ferias, data_inicio_ferias, data_fim_ferias')
    .neq('email', PMPL_FALLBACK_OWNER_EMAIL)
    .order('nome', { ascending: true })

  const emailsResult = await supabase
    .from('administrador_emails')
    .select('administrador_id, email')

  if (emailsResult.error) throw emailsResult.error

  const emailsPorAdmin = new Map<string, string[]>()
  for (const row of emailsResult.data ?? []) {
    const lista = emailsPorAdmin.get(row.administrador_id) ?? []
    lista.push(row.email)
    emailsPorAdmin.set(row.administrador_id, lista)
  }

  if (fullPeopleResult.error && isMissingVacationColumnsError(fullPeopleResult.error)) {
    const legacyPeopleResult = await supabase
      .from('administradores')
      .select('id, nome, email, role, ativo, recebe_distribuicao, em_ferias')
      .neq('email', PMPL_FALLBACK_OWNER_EMAIL)
      .order('nome', { ascending: true })

    if (legacyPeopleResult.error) throw legacyPeopleResult.error

    return (legacyPeopleResult.data ?? []).map((item) => ({
      ...(item as Omit<AdminPerson, 'especialidade' | 'data_inicio_ferias' | 'data_fim_ferias' | 'emailsAdicionais'>),
      especialidade: 'geral',
      data_inicio_ferias: null,
      data_fim_ferias: null,
      emailsAdicionais: emailsPorAdmin.get(item.id) ?? [],
    })) as AdminPerson[]
  }

  if (fullPeopleResult.error) throw fullPeopleResult.error
  return (fullPeopleResult.data ?? []).map((item) => ({
    ...item,
    emailsAdicionais: emailsPorAdmin.get(item.id) ?? [],
  })) as AdminPerson[]
}

async function loadSaturdayScheduleSlots(
  supabase: ReturnType<typeof createAdminClient>,
  monthKey: string,
): Promise<SaturdayScheduleSlot[]> {
  const window = getSaturdayScheduleMonthWindow(monthKey)

  const { data: scheduleData, error: scheduleError } = await supabase
    .from('escala_distribuicao_sabado')
    .select('id, data_escala, hora_fim')
    .gte('data_escala', window.startDate)
    .lt('data_escala', window.endExclusiveDate)
    .order('data_escala', { ascending: true })

  if (scheduleError) throw scheduleError

  const schedules = (scheduleData ?? []) as SaturdayScheduleRow[]
  const scheduleIds = schedules.map((item) => item.id)

  let participants: SaturdayScheduleParticipantRow[] = []
  if (scheduleIds.length > 0) {
    const { data: participantData, error: participantError } = await supabase
      .from('escala_distribuicao_sabado_participantes')
      .select('escala_id, administrador_id')
      .in('escala_id', scheduleIds)

    if (participantError) throw participantError
    participants = (participantData ?? []) as SaturdayScheduleParticipantRow[]
  }

  return buildSaturdayScheduleSlots(monthKey, mergeSaturdayScheduleRows(schedules, participants))
}

async function loadOperacionaisComUnidades(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<OperacionalAdmin[]> {
  const [opResult, unidadesResult] = await Promise.all([
    supabase
      .from('dim_operacionais')
      .select('codigo, nome, ativo, avatar_url, especialidade, created_at, updated_at')
      .order('nome'),
    supabase
      .from('operacional_unidades')
      .select('id, operacional_codigo, unidade, grupo_nome')
      .order('grupo_nome')
      .order('unidade'),
  ])

  if (opResult.error) throw opResult.error

  const unidadesByCode = new Map<string, OperacionalUnidade[]>()
  for (const u of (unidadesResult.data ?? [])) {
    const existing = unidadesByCode.get(u.operacional_codigo) ?? []
    existing.push({
      id: u.id,
      operacional_codigo: u.operacional_codigo,
      unidade: u.unidade,
      grupo_nome: u.grupo_nome,
    })
    unidadesByCode.set(u.operacional_codigo, existing)
  }

  return (opResult.data ?? []).map((op) => ({
    codigo: op.codigo,
    nome: op.nome,
    ativo: op.ativo,
    avatar_url: op.avatar_url ?? null,
    especialidade: op.especialidade ?? null,
    created_at: op.created_at,
    updated_at: op.updated_at,
    unidades: unidadesByCode.get(op.codigo) ?? [],
  }))
}

async function loadTodasUnidades(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('dim_centro_unidade')
    .select('unidade')
    .order('unidade')

  if (error) throw error
  return (data ?? []).map((row) => row.unidade as string)
}

export async function loadAdministrationPageData(params?: {
  selectedSaturdayScheduleMonth?: string | null
}): Promise<AdministrationPageData> {
  const supabase = createAdminClient()
  const people = await loadAdminPeople(supabase)
  const saturdayScheduleMonthKey = normalizeSaturdayScheduleMonthKey(params?.selectedSaturdayScheduleMonth)

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

  const saturdayScheduleCandidates = people
    .filter((person) => person.role === 'admin' && person.especialidade === 'geral')
    .map((person) => ({
      id: person.id,
      nome: person.nome,
      email: person.email,
      ativo: person.ativo,
      em_ferias: person.em_ferias,
    }))

  const [saturdayScheduleSlots, operacionais, todasUnidades] = await Promise.all([
    loadSaturdayScheduleSlots(supabase, saturdayScheduleMonthKey),
    loadOperacionaisComUnidades(supabase),
    loadTodasUnidades(supabase),
  ])

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
    saturdayScheduleMonthKey,
    saturdayScheduleCandidates,
    saturdayScheduleSlots,
    operacionais,
    todasUnidades,
  }
}
