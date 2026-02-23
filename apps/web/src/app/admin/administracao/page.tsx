import { createClient } from '@/lib/supabase/server'
import { isVacationActive, resolveCurrentPmplOwner } from '@/lib/orders/pmpl-routing'
import { AdminPeopleManager } from '@/components/admin/admin-people-manager'
import { AdminOrderTypeOwnerManager } from '@/components/admin/admin-order-type-owner-manager'
import type { PmplOwnerResolution } from '@/lib/orders/pmpl-routing'

export const dynamic = 'force-dynamic'

interface AdminPersonRow {
  id: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  especialidade: string
  ativo: boolean
  em_ferias: boolean
  data_inicio_ferias: string | null
  data_fim_ferias: string | null
}

interface PmplConfigRow {
  responsavel_id: string | null
  substituto_id: string | null
}

function isMissingVacationColumnsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return (error.message ?? '').toLowerCase().includes('data_inicio_ferias')
    || (error.message ?? '').toLowerCase().includes('data_fim_ferias')
}

export default async function AdministracaoPage() {
  const supabase = await createClient()

  let people: AdminPersonRow[] = []
  {
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

      people = (legacyPeopleResult.data ?? []).map((item) => ({
        ...(item as Omit<AdminPersonRow, 'especialidade' | 'data_inicio_ferias' | 'data_fim_ferias'>),
        especialidade: 'geral',
        data_inicio_ferias: null,
        data_fim_ferias: null,
      }))
    } else {
      if (fullPeopleResult.error) throw fullPeopleResult.error
      people = (fullPeopleResult.data ?? []) as AdminPersonRow[]
    }
  }

  let configLoadError: string | null = null
  let pmplConfig: PmplConfigRow | null = null
  const { data: configData, error: configError } = await supabase
    .from('responsaveis_tipo_ordem')
    .select('responsavel_id, substituto_id')
    .eq('tipo_ordem', 'PMPL')
    .maybeSingle()

  if (configError && configError.code !== 'PGRST116') {
    configLoadError = (configError.code === '42P01' || configError.code === 'PGRST205')
      ? 'Tabela de configuração PMPL ainda não existe. Aplique as migrations 00043/00044.'
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
    configLoadError = configLoadError ?? (error instanceof Error ? error.message : 'Falha ao resolver responsável PMPL')
  }
  const configuredResponsavel = pmplConfig?.responsavel_id ? personById.get(pmplConfig.responsavel_id) ?? null : null
  const configuredSubstituto = pmplConfig?.substituto_id ? personById.get(pmplConfig.substituto_id) ?? null : null
  const currentOwner = pmplResolution.currentOwner

  const currentOwnerStatus = currentOwner
    ? (isVacationActive(currentOwner) ? 'Férias' : 'Ativo')
    : 'Indisponível'

  const ownerCandidates = people
    .filter((person) => person.ativo && (person.role === 'admin' || person.role === 'gestor'))
    .map((person) => ({
      id: person.id,
      nome: person.nome,
      email: person.email,
      role: person.role,
      ativo: person.ativo,
    }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
        <p className="text-sm text-muted-foreground">
          Gestão de pessoas e responsável PMPL com substituição automática em férias.
        </p>
      </div>

      <AdminPeopleManager people={people} />

      <AdminOrderTypeOwnerManager
        candidates={ownerCandidates}
        initialResponsavelId={pmplConfig?.responsavel_id ?? null}
        initialSubstitutoId={pmplConfig?.substituto_id ?? null}
        configuredResponsavelNome={configuredResponsavel?.nome ?? null}
        configuredSubstitutoNome={configuredSubstituto?.nome ?? null}
        currentOwnerNome={currentOwner?.nome ?? null}
        currentOwnerEmail={currentOwner?.email ?? null}
        currentOwnerStatus={currentOwnerStatus}
        fallbackGestorNome={pmplResolution.fallbackGestor?.nome ?? null}
        configLoadError={configLoadError}
      />
    </div>
  )
}
