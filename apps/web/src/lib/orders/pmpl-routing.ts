import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/types/database'

const ROUTING_BATCH_SIZE = 1000
const REASSIGN_CHUNK_SIZE = 200
const PMPL_CONFIG_TYPE = 'PMPL'

const FIXED_OWNER_EMAIL_BY_KEY = {
  brenda: 'brendafonseca@bemol.com.br',
  adriano: 'adrianobezerra@bemol.com.br',
} as const

export const FIXED_OWNER_LABEL_BY_KEY = {
  brenda: 'Brenda (CD MANAUS)',
  adriano: 'Adriano (CD TARUMÃ)',
} as const

const UNIT_TO_FIXED_OWNER_KEY = {
  'CD MANAUS': 'brenda',
  'CD TARUMA': 'adriano',
  'CD FARMA TARUMA': 'adriano',
} as const

const ROUTING_UNITS = Object.keys(UNIT_TO_FIXED_OWNER_KEY)

type FixedOwnerKey = keyof typeof FIXED_OWNER_EMAIL_BY_KEY

type RoutingSupabase = SupabaseClient<any, 'public', any>

interface AdminRoutingRecord {
  id: string
  nome: string | null
  email: string
  role: UserRole
  ativo: boolean
  em_ferias: boolean
  data_inicio_ferias: string | null
  data_fim_ferias: string | null
}

interface PmplConfigRow {
  responsavel_id: string | null
  substituto_id: string | null
}

interface RoutingCandidateRow {
  ordem_id: string
  nota_id: string
  ordem_codigo: string | null
  tipo_ordem: string | null
  unidade: string | null
  responsavel_atual_id: string | null
  responsavel_atual_nome: string | null
}

interface PendingAssignment {
  notaId: string
  administradorDestinoId: string
  ordemCodigo: string | null
  tipoOrdem: string | null
  unidade: string | null
  responsavelAnteriorId: string | null
  responsavelAnteriorNome: string | null
  responsavelNovoNome: string
  origem: 'pmpl' | 'cd'
}

export interface PmplOwnerResolution {
  currentOwner: AdminRoutingRecord | null
  configuredResponsavel: AdminRoutingRecord | null
  configuredSubstituto: AdminRoutingRecord | null
  fallbackGestor: AdminRoutingRecord | null
  viewerAdminIds: string[]
}

export interface ApplyAutomaticOrdersRoutingParams {
  supabase: RoutingSupabase
  gestorId: string
  debug?: boolean
  motivo?: string
}

export interface ApplyAutomaticOrdersRoutingResult {
  movedCount: number
  pendingCount: number
  conflictCount: number
  detectedPmpl: number
  detectedByUnit: Record<string, number>
  fixedOwnerLabelByAdminId: Map<string, string>
  pmplResolution: PmplOwnerResolution
}

export function normalizeUnit(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function parseDateStart(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseDateEnd(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T23:59:59.999Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isRoleEligible(role: string | null | undefined): role is UserRole {
  return role === 'admin' || role === 'gestor'
}

function isAssignable(admin: AdminRoutingRecord | null): admin is AdminRoutingRecord {
  if (!admin) return false
  if (!admin.ativo) return false
  if (!isRoleEligible(admin.role)) return false
  return !isVacationActive(admin)
}

function asAdminRoutingRecord(row: Partial<AdminRoutingRecord>): AdminRoutingRecord | null {
  if (!row.id || !row.email || !row.role || !isRoleEligible(row.role) || typeof row.ativo !== 'boolean') {
    return null
  }

  return {
    id: row.id,
    nome: row.nome ?? null,
    email: row.email,
    role: row.role,
    ativo: row.ativo,
    em_ferias: Boolean(row.em_ferias),
    data_inicio_ferias: row.data_inicio_ferias ?? null,
    data_fim_ferias: row.data_fim_ferias ?? null,
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function resolveFixedOwnerKeyByUnit(value: string | null | undefined): FixedOwnerKey | null {
  const normalized = normalizeUnit(value)
  if (!normalized) return null
  return UNIT_TO_FIXED_OWNER_KEY[normalized as keyof typeof UNIT_TO_FIXED_OWNER_KEY] ?? null
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01'
}

async function fetchAdminsByIds(supabase: RoutingSupabase, ids: string[]): Promise<AdminRoutingRecord[]> {
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('administradores')
    .select('id, nome, email, role, ativo, em_ferias, data_inicio_ferias, data_fim_ferias')
    .in('id', ids)

  if (error) throw error

  return ((data ?? []) as Array<Partial<AdminRoutingRecord>>)
    .map(asAdminRoutingRecord)
    .filter((item): item is AdminRoutingRecord => Boolean(item))
}

async function fetchFirstEligibleGestor(supabase: RoutingSupabase): Promise<AdminRoutingRecord | null> {
  const { data, error } = await supabase
    .from('administradores')
    .select('id, nome, email, role, ativo, em_ferias, data_inicio_ferias, data_fim_ferias')
    .eq('role', 'gestor')
    .eq('ativo', true)
    .order('nome', { ascending: true })
    .limit(50)

  if (error) throw error

  const gestores = ((data ?? []) as Array<Partial<AdminRoutingRecord>>)
    .map(asAdminRoutingRecord)
    .filter((item): item is AdminRoutingRecord => Boolean(item))

  for (const gestor of gestores) {
    if (!isVacationActive(gestor)) return gestor
  }

  return null
}

async function fetchPmplConfig(supabase: RoutingSupabase): Promise<PmplConfigRow | null> {
  const { data, error } = await supabase
    .from('responsaveis_tipo_ordem')
    .select('responsavel_id, substituto_id')
    .eq('tipo_ordem', PMPL_CONFIG_TYPE)
    .maybeSingle()

  if (error) {
    if (isMissingRelation(error)) return null
    throw error
  }

  if (!data) return null

  return {
    responsavel_id: data.responsavel_id ?? null,
    substituto_id: data.substituto_id ?? null,
  }
}

async function fetchAllRoutingRows(
  supabase: RoutingSupabase,
  buildQuery: () => any
): Promise<RoutingCandidateRow[]> {
  const rows: RoutingCandidateRow[] = []
  let from = 0

  while (true) {
    const query = buildQuery()

    const { data, error } = await query
      .order('ordem_id', { ascending: true })
      .range(from, from + ROUTING_BATCH_SIZE - 1)

    if (error) throw error

    const batch = (data ?? []) as RoutingCandidateRow[]
    rows.push(...batch)

    if (batch.length < ROUTING_BATCH_SIZE) break
    from += ROUTING_BATCH_SIZE
  }

  return rows
}

async function resolveFixedCdOwnersByKey(supabase: RoutingSupabase): Promise<Partial<Record<FixedOwnerKey, AdminRoutingRecord>>> {
  const fixedOwnerKeyByEmail: Record<string, FixedOwnerKey> = {
    [normalizeEmail(FIXED_OWNER_EMAIL_BY_KEY.brenda)]: 'brenda',
    [normalizeEmail(FIXED_OWNER_EMAIL_BY_KEY.adriano)]: 'adriano',
  }

  const { data, error } = await supabase
    .from('administradores')
    .select('id, nome, email, role, ativo, em_ferias, data_inicio_ferias, data_fim_ferias')
    .in('email', Object.values(FIXED_OWNER_EMAIL_BY_KEY))

  if (error) throw error

  const byKey: Partial<Record<FixedOwnerKey, AdminRoutingRecord>> = {}

  for (const item of ((data ?? []) as Array<Partial<AdminRoutingRecord>>)) {
    const record = asAdminRoutingRecord(item)
    if (!record) continue

    const key = fixedOwnerKeyByEmail[normalizeEmail(record.email)]
    if (!key) continue
    if (record.role !== 'admin') continue
    if (!isAssignable(record)) continue

    byKey[key] = record
  }

  return byKey
}

export async function getFixedOwnerLabelByAdminId(supabase: RoutingSupabase): Promise<Map<string, string>> {
  const fixedByKey = await resolveFixedCdOwnersByKey(supabase)
  const labelByAdminId = new Map<string, string>()

  for (const key of Object.keys(fixedByKey) as FixedOwnerKey[]) {
    const admin = fixedByKey[key]
    if (!admin) continue
    labelByAdminId.set(admin.id, FIXED_OWNER_LABEL_BY_KEY[key])
  }

  return labelByAdminId
}

export function isVacationActive(
  admin: Pick<AdminRoutingRecord, 'em_ferias' | 'data_inicio_ferias' | 'data_fim_ferias'>,
  now: Date = new Date()
): boolean {
  if (admin.em_ferias) return true

  const start = parseDateStart(admin.data_inicio_ferias)
  if (!start) return false

  const end = parseDateEnd(admin.data_fim_ferias)
  if (!end) {
    return now.getTime() >= start.getTime()
  }

  return now.getTime() >= start.getTime() && now.getTime() <= end.getTime()
}

export async function resolveCurrentPmplOwner(supabase: RoutingSupabase): Promise<PmplOwnerResolution> {
  const config = await fetchPmplConfig(supabase)
  const configuredIds = [config?.responsavel_id, config?.substituto_id]
    .filter((value): value is string => Boolean(value))

  const configuredAdmins = await fetchAdminsByIds(supabase, configuredIds)
  const adminById = new Map(configuredAdmins.map((item) => [item.id, item]))

  const configuredResponsavel = config?.responsavel_id ? (adminById.get(config.responsavel_id) ?? null) : null
  const configuredSubstituto = config?.substituto_id ? (adminById.get(config.substituto_id) ?? null) : null

  let currentOwner: AdminRoutingRecord | null = null
  let fallbackGestor: AdminRoutingRecord | null = null

  if (isAssignable(configuredResponsavel)) {
    currentOwner = configuredResponsavel
  } else if (isAssignable(configuredSubstituto)) {
    currentOwner = configuredSubstituto
  } else {
    fallbackGestor = await fetchFirstEligibleGestor(supabase)
    if (fallbackGestor) {
      currentOwner = fallbackGestor
    }
  }

  const viewerIds = new Set<string>()
  if (currentOwner) viewerIds.add(currentOwner.id)
  if (configuredSubstituto?.ativo) viewerIds.add(configuredSubstituto.id)

  return {
    currentOwner,
    configuredResponsavel,
    configuredSubstituto,
    fallbackGestor,
    viewerAdminIds: Array.from(viewerIds),
  }
}

export function canAccessPmplTab(params: {
  role: UserRole
  loggedAdminId: string
  pmplResolution: PmplOwnerResolution
}): boolean {
  if (params.role === 'gestor') return true
  return params.pmplResolution.viewerAdminIds.includes(params.loggedAdminId)
}

export async function applyAutomaticOrdersRouting({
  supabase,
  gestorId,
  debug = false,
  motivo,
}: ApplyAutomaticOrdersRoutingParams): Promise<ApplyAutomaticOrdersRoutingResult> {
  const fixedOwnerByKey = await resolveFixedCdOwnersByKey(supabase)
  const fixedOwnerLabelByAdminId = new Map<string, string>()

  for (const key of Object.keys(fixedOwnerByKey) as FixedOwnerKey[]) {
    const admin = fixedOwnerByKey[key]
    if (!admin) continue
    fixedOwnerLabelByAdminId.set(admin.id, FIXED_OWNER_LABEL_BY_KEY[key])
  }

  const pmplResolution = await resolveCurrentPmplOwner(supabase)

  const [pmplRows, cdRows] = await Promise.all([
    fetchAllRoutingRows(supabase, () => (
      supabase
        .from('vw_ordens_notas_painel')
        .select('ordem_id, nota_id, ordem_codigo, tipo_ordem, unidade, responsavel_atual_id, responsavel_atual_nome')
        .eq('tipo_ordem', PMPL_CONFIG_TYPE)
        .not('nota_id', 'is', null)
    )),
    fetchAllRoutingRows(supabase, () => (
      supabase
        .from('vw_ordens_notas_painel')
        .select('ordem_id, nota_id, ordem_codigo, tipo_ordem, unidade, responsavel_atual_id, responsavel_atual_nome')
        .in('unidade', ROUTING_UNITS)
        .not('nota_id', 'is', null)
    )),
  ])

  const detectedByUnit: Record<string, number> = {
    'CD MANAUS': 0,
    'CD TARUMA': 0,
    'CD FARMA TARUMA': 0,
  }

  const pendingByNota = new Map<string, PendingAssignment>()
  const conflictNotaIds = new Set<string>()

  const pmplOwner = pmplResolution.currentOwner
  for (const row of pmplRows) {
    if (!pmplOwner) continue
    if (!row.nota_id) continue
    if (row.responsavel_atual_id === pmplOwner.id) continue

    pendingByNota.set(row.nota_id, {
      notaId: row.nota_id,
      administradorDestinoId: pmplOwner.id,
      ordemCodigo: row.ordem_codigo,
      tipoOrdem: row.tipo_ordem,
      unidade: row.unidade,
      responsavelAnteriorId: row.responsavel_atual_id,
      responsavelAnteriorNome: row.responsavel_atual_nome,
      responsavelNovoNome: pmplOwner.nome ?? pmplOwner.email,
      origem: 'pmpl',
    })
  }

  for (const row of cdRows) {
    const ownerKey = resolveFixedOwnerKeyByUnit(row.unidade)
    if (!ownerKey) continue

    const normalizedUnit = normalizeUnit(row.unidade)
    if (normalizedUnit in detectedByUnit) {
      detectedByUnit[normalizedUnit] += 1
    }

    if (!row.nota_id) continue
    if (conflictNotaIds.has(row.nota_id)) continue

    const fixedOwner = fixedOwnerByKey[ownerKey]
    if (!fixedOwner) continue

    const existing = pendingByNota.get(row.nota_id)
    if (existing) {
      // PMPL sempre vence qualquer regra de CD.
      if (existing.origem === 'pmpl') continue

      // Mesmo destino calculado por mais de uma regra de CD: mantém.
      if (existing.administradorDestinoId === fixedOwner.id) continue

      // Destinos diferentes para a mesma nota: ignora para evitar realocação indevida.
      conflictNotaIds.add(row.nota_id)
      pendingByNota.delete(row.nota_id)
      continue
    }

    if (row.responsavel_atual_id === fixedOwner.id) continue

    pendingByNota.set(row.nota_id, {
      notaId: row.nota_id,
      administradorDestinoId: fixedOwner.id,
      ordemCodigo: row.ordem_codigo,
      tipoOrdem: row.tipo_ordem,
      unidade: row.unidade,
      responsavelAnteriorId: row.responsavel_atual_id,
      responsavelAnteriorNome: row.responsavel_atual_nome,
      responsavelNovoNome: FIXED_OWNER_LABEL_BY_KEY[ownerKey],
      origem: 'cd',
    })
  }

  const pendingList = Array.from(pendingByNota.values())
  const pendingByDestino = new Map<string, string[]>()

  for (const item of pendingList) {
    const notaIds = pendingByDestino.get(item.administradorDestinoId) ?? []
    notaIds.push(item.notaId)
    pendingByDestino.set(item.administradorDestinoId, notaIds)
  }

  let movedCount = 0
  for (const [administradorDestinoId, notaIds] of pendingByDestino.entries()) {
    const uniqueNotaIds = Array.from(new Set(notaIds))
    const chunks = chunkArray(uniqueNotaIds, REASSIGN_CHUNK_SIZE)

    for (const notaIdsChunk of chunks) {
      const { data, error } = await supabase.rpc('reatribuir_ordens_selecionadas', {
        p_nota_ids: notaIdsChunk,
        p_gestor_id: gestorId,
        p_modo: 'destino_unico',
        p_admin_destino: administradorDestinoId,
        p_motivo: motivo ?? 'Auto realocação PMPL/CD (Painel de Ordens)',
      })

      if (error) throw error
      movedCount += ((data ?? []) as Array<{ nota_id: string }>).length
    }
  }

  if (debug) {
    console.log('[DEBUG orders/routing] detectadas_pmpl:', pmplRows.length)
    console.log('[DEBUG orders/routing] detectadas_por_unidade:', JSON.stringify(detectedByUnit))
    console.log('[DEBUG orders/routing] notas_pendentes:', pendingList.length)
    console.log('[DEBUG orders/routing] notas_com_conflito:', conflictNotaIds.size)
    console.log('[DEBUG orders/routing] notas_conflito_amostra:', JSON.stringify(Array.from(conflictNotaIds).slice(0, 5)))
    console.log('[DEBUG orders/routing] notas_reatribuidas:', movedCount)
    console.log(
      '[DEBUG orders/routing] amostra_reatribuicoes:',
      JSON.stringify(
        pendingList.slice(0, 5).map((item) => ({
          ordem_codigo: item.ordemCodigo,
          tipo_ordem: item.tipoOrdem,
          unidade: item.unidade,
          origem_regra: item.origem,
          responsavel_anterior: item.responsavelAnteriorNome ?? item.responsavelAnteriorId,
          responsavel_novo: item.responsavelNovoNome,
        }))
      )
    )
  }

  return {
    movedCount,
    pendingCount: pendingList.length,
    conflictCount: conflictNotaIds.size,
    detectedPmpl: pmplRows.length,
    detectedByUnit,
    fixedOwnerLabelByAdminId,
    pmplResolution,
  }
}
