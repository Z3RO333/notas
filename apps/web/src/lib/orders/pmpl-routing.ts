import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/types/database'

const ROUTING_BATCH_SIZE = 1000
const REASSIGN_CHUNK_SIZE = 200
const PMPL_CONFIG_TYPE = 'PMPL'
const REFRIGERACAO_ESPECIALIDADE = 'refrigeracao'
const SUELEM_EMAIL = 'suelemsilva@bemol.com.br'
const GUSTAVO_EMAIL = 'gustavoandrade@bemol.com.br'
const REFRIGERACAO_FALLBACK_GESTOR_EMAILS = [
  'walterrodrigues@bemol.com.br',
  'danieldamasceno@bemol.com.br',
] as const

const FIXED_OWNER_EMAIL_BY_KEY = {
  brenda: 'brendafonseca@bemol.com.br',
  adriano: 'adrianobezerra@bemol.com.br',
} as const

export const FIXED_OWNER_LABEL_BY_KEY = {
  brenda: 'Brenda Rodrigues',
  adriano: 'Adriano Bezerra',
} as const

const UNIT_TO_FIXED_OWNER_KEY = {
  'CD MANAUS': 'brenda',
  'CD TARUMA': 'adriano',
  'CD FARMA TARUMA': 'adriano',
} as const

type FixedOwnerKey = keyof typeof FIXED_OWNER_EMAIL_BY_KEY

type RoutingSupabase = SupabaseClient
type RoutePage = 'PMOS' | 'PMPL'
type RouteReason = 'pmpl' | 'refrigeracao' | 'cd' | 'none'

type QueryError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null

interface QueryResult<T> {
  data: T[] | null
  error: QueryError
}

interface RangeableRoutingQuery {
  order: (
    column: string,
    options: { ascending: boolean }
  ) => {
    range: (from: number, to: number) => PromiseLike<QueryResult<RoutingCandidateRow>>
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

function extractQueryError(result: unknown): QueryError {
  const record = toRecord(result)
  if (!record) return { message: 'invalid query result' }

  const rawError = record.error
  if (rawError == null) return null

  const errorRecord = toRecord(rawError)
  if (!errorRecord) return { message: String(rawError) }

  return {
    code: typeof errorRecord.code === 'string' ? errorRecord.code : undefined,
    message: typeof errorRecord.message === 'string' ? errorRecord.message : undefined,
    details: typeof errorRecord.details === 'string' ? errorRecord.details : null,
    hint: typeof errorRecord.hint === 'string' ? errorRecord.hint : null,
  }
}

function extractQueryRows<T>(result: unknown): T[] {
  const record = toRecord(result)
  if (!record) return []
  return Array.isArray(record.data) ? (record.data as T[]) : []
}

function asRangeableRoutingQuery(value: unknown): RangeableRoutingQuery | null {
  const record = toRecord(value)
  if (!record) return null
  if (typeof record.order !== 'function') return null
  return value as RangeableRoutingQuery
}

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
  tipo_ordem?: string | null
  unidade: string | null
  descricao: string | null
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
  origem: RouteReason
  pagina: RoutePage
}

interface RouteOrderContext {
  pmplOwnerId: string | null
  refrigeracaoOwnerId: string | null
  fixedOwnerByKey: Partial<Record<FixedOwnerKey, AdminRoutingRecord>>
  refrigeracaoKeywords: string[]
}

interface RouteOrderResult {
  page: RoutePage
  ownerId: string | null
  reason: RouteReason
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

function normalizeTextForMatch(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
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
  if (admin.role !== 'admin') return false
  return !isVacationActive(admin)
}

function isPmplOwnerAssignable(admin: AdminRoutingRecord | null): admin is AdminRoutingRecord {
  if (!admin) return false
  if (!admin.ativo) return false
  if (isVacationActive(admin)) return false

  const email = normalizeEmail(admin.email)
  return admin.role === 'admin' || email === GUSTAVO_EMAIL
}

function isRefrigeracaoFallbackGestor(admin: AdminRoutingRecord | null): admin is AdminRoutingRecord {
  if (!admin) return false
  if (!admin.ativo) return false
  if (admin.role !== 'gestor') return false
  if (isVacationActive(admin)) return false

  const email = normalizeEmail(admin.email)
  return REFRIGERACAO_FALLBACK_GESTOR_EMAILS.some((candidate) => candidate === email)
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

function isPmplType(value: string | null | undefined): boolean {
  return normalizeTextForMatch(value) === PMPL_CONFIG_TYPE
}

function isRefrigeracaoOrder(descricao: string | null | undefined, keywords: string[]): boolean {
  if (!descricao || keywords.length === 0) return false

  const normalizedDescription = normalizeTextForMatch(descricao)
  if (!normalizedDescription) return false

  return keywords.some((keyword) => (
    keyword.length > 0
    && normalizedDescription.includes(keyword)
  ))
}

function routeOrder(row: RoutingCandidateRow, context: RouteOrderContext): RouteOrderResult {
  if (isPmplType(row.tipo_ordem)) {
    return {
      page: 'PMPL',
      ownerId: context.pmplOwnerId,
      reason: 'pmpl',
    }
  }

  if (isRefrigeracaoOrder(row.descricao, context.refrigeracaoKeywords)) {
    return {
      page: 'PMOS',
      ownerId: context.refrigeracaoOwnerId,
      reason: 'refrigeracao',
    }
  }

  const fixedOwnerKey = resolveFixedOwnerKeyByUnit(row.unidade)
  if (fixedOwnerKey) {
    return {
      page: 'PMOS',
      ownerId: context.fixedOwnerByKey[fixedOwnerKey]?.id ?? null,
      reason: 'cd',
    }
  }

  return {
    page: 'PMOS',
    ownerId: null,
    reason: 'none',
  }
}

function hasMessage(error: { message?: string; details?: string | null; hint?: string | null } | null, token: string): boolean {
  if (!error) return false
  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return haystack.includes(token.toLowerCase())
}

function isMissingRelation(error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || hasMessage(error, 'does not exist')
}

function isMissingVacationColumns(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return (
    hasMessage(error, 'data_inicio_ferias')
    || hasMessage(error, 'data_fim_ferias')
    || hasMessage(error, 'column')
  )
}

function isMissingTipoOrdemColumn(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return hasMessage(error, 'tipo_ordem')
}

async function fetchAdministradoresWithVacationFallback(
  supabase: RoutingSupabase,
  buildQuery: (columns: string) => unknown
): Promise<AdminRoutingRecord[]> {
  const fullColumns = 'id, nome, email, role, ativo, em_ferias, data_inicio_ferias, data_fim_ferias'
  const legacyColumns = 'id, nome, email, role, ativo, em_ferias'

  const fullResult = await Promise.resolve(buildQuery(fullColumns))
  const fullError = extractQueryError(fullResult)
  if (fullError && isMissingVacationColumns(fullError)) {
    const legacyResult = await Promise.resolve(buildQuery(legacyColumns))
    const legacyError = extractQueryError(legacyResult)
    if (legacyError) throw legacyError
    return extractQueryRows<Partial<AdminRoutingRecord>>(legacyResult)
      .map(asAdminRoutingRecord)
      .filter((item): item is AdminRoutingRecord => Boolean(item))
  }

  if (fullError) throw fullError

  return extractQueryRows<Partial<AdminRoutingRecord>>(fullResult)
    .map(asAdminRoutingRecord)
    .filter((item): item is AdminRoutingRecord => Boolean(item))
}

async function fetchAdminsByIds(supabase: RoutingSupabase, ids: string[]): Promise<AdminRoutingRecord[]> {
  if (ids.length === 0) return []

  return fetchAdministradoresWithVacationFallback(supabase, (columns) => (
    supabase
      .from('administradores')
      .select(columns)
      .in('id', ids)
  ))
}

async function fetchAdminByEmail(supabase: RoutingSupabase, email: string): Promise<AdminRoutingRecord | null> {
  const rows = await fetchAdministradoresWithVacationFallback(supabase, (columns) => (
    supabase
      .from('administradores')
      .select(columns)
      .eq('email', email)
      .limit(1)
  ))

  return rows[0] ?? null
}

async function fetchFirstEligibleGestorByEmailPriority(
  supabase: RoutingSupabase,
  emails: readonly string[]
): Promise<AdminRoutingRecord | null> {
  for (const email of emails) {
    const admin = await fetchAdminByEmail(supabase, email)
    if (isRefrigeracaoFallbackGestor(admin)) return admin
  }

  return null
}

async function fetchRefrigeracaoKeywords(supabase: RoutingSupabase): Promise<string[]> {
  const { data, error } = await supabase
    .from('regras_distribuicao')
    .select('palavra_chave')
    .eq('especialidade', REFRIGERACAO_ESPECIALIDADE)

  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }

  const normalized = (data ?? [])
    .map((row) => normalizeTextForMatch(row.palavra_chave))
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set(normalized))
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
  buildQuery: () => unknown
): Promise<RoutingCandidateRow[]> {
  const rows: RoutingCandidateRow[] = []
  let from = 0

  while (true) {
    const query = asRangeableRoutingQuery(buildQuery())
    if (!query) throw new Error('invalid routing query builder')

    const result = await query
      .order('ordem_id', { ascending: true })
      .range(from, from + ROUTING_BATCH_SIZE - 1)

    const error = extractQueryError(result)
    if (error) throw error

    const batch = extractQueryRows<RoutingCandidateRow>(result)
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

  const data = await fetchAdministradoresWithVacationFallback(supabase, (columns) => (
    supabase
      .from('administradores')
      .select(columns)
      .in('email', Object.values(FIXED_OWNER_EMAIL_BY_KEY))
  ))

  const byKey: Partial<Record<FixedOwnerKey, AdminRoutingRecord>> = {}

  for (const record of data) {

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

  if (isPmplOwnerAssignable(configuredResponsavel)) {
    currentOwner = configuredResponsavel
  } else if (isPmplOwnerAssignable(configuredSubstituto)) {
    currentOwner = configuredSubstituto
  } else {
    const gustavo = await fetchAdminByEmail(supabase, GUSTAVO_EMAIL)
    if (isPmplOwnerAssignable(gustavo)) {
      currentOwner = gustavo
      fallbackGestor = gustavo
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
  const suelemAdmin = await fetchAdminByEmail(supabase, SUELEM_EMAIL)
  const refrigeracaoFallbackGestor = await fetchFirstEligibleGestorByEmailPriority(
    supabase,
    REFRIGERACAO_FALLBACK_GESTOR_EMAILS
  )
  const refrigeracaoOwner = isAssignable(suelemAdmin) ? suelemAdmin : refrigeracaoFallbackGestor
  const refrigeracaoKeywords = await fetchRefrigeracaoKeywords(supabase)

  let routingRows: RoutingCandidateRow[] = []
  try {
    routingRows = await fetchAllRoutingRows(supabase, () => (
      supabase
        .from('vw_ordens_notas_painel')
        .select('ordem_id, nota_id, ordem_codigo, tipo_ordem, unidade, descricao, responsavel_atual_id, responsavel_atual_nome')
        .not('nota_id', 'is', null)
    ))
  } catch (error) {
    if (isMissingTipoOrdemColumn(error as { code?: string; message?: string; details?: string | null; hint?: string | null })) {
      if (debug) {
        console.log('[DEBUG orders/routing] coluna tipo_ordem ausente no banco. Roteamento PMPL desativado.')
      }
      routingRows = await fetchAllRoutingRows(supabase, () => (
        supabase
          .from('vw_ordens_notas_painel')
          .select('ordem_id, nota_id, ordem_codigo, unidade, descricao, responsavel_atual_id, responsavel_atual_nome')
          .not('nota_id', 'is', null)
      ))
    } else {
      throw error
    }
  }

  const detectedByUnit: Record<string, number> = {
    'CD MANAUS': 0,
    'CD TARUMA': 0,
    'CD FARMA TARUMA': 0,
  }

  const detectedByPage: Record<RoutePage, number> = {
    PMOS: 0,
    PMPL: 0,
  }

  const detectedByReason: Record<RouteReason, number> = {
    pmpl: 0,
    refrigeracao: 0,
    cd: 0,
    none: 0,
  }

  const pendingByNota = new Map<string, PendingAssignment>()
  const conflictNotaIds = new Set<string>()
  const destinationNameByAdminId = new Map<string, string>(fixedOwnerLabelByAdminId)

  if (pmplResolution.currentOwner) {
    destinationNameByAdminId.set(
      pmplResolution.currentOwner.id,
      pmplResolution.currentOwner.nome ?? pmplResolution.currentOwner.email
    )
  }

  if (refrigeracaoOwner) {
    destinationNameByAdminId.set(
      refrigeracaoOwner.id,
      refrigeracaoOwner.nome ?? refrigeracaoOwner.email
    )
  }

  const routeContext: RouteOrderContext = {
    pmplOwnerId: pmplResolution.currentOwner?.id ?? null,
    refrigeracaoOwnerId: refrigeracaoOwner?.id ?? null,
    fixedOwnerByKey,
    refrigeracaoKeywords,
  }

  const groupsByOrder = new Map<string, Set<string>>()
  const duplicatedGroupsByOrder = new Map<string, { ordemCodigo: string | null; groups: Set<string> }>()

  for (const row of routingRows) {
    if (!row.nota_id) continue

    const routeResult = routeOrder(row, routeContext)
    detectedByPage[routeResult.page] += 1
    detectedByReason[routeResult.reason] += 1

    if (routeResult.reason === 'cd') {
      const normalizedUnit = normalizeUnit(row.unidade)
      if (normalizedUnit in detectedByUnit) {
        detectedByUnit[normalizedUnit] += 1
      }
    }

    const groupingKey = `${routeResult.page}:${routeResult.ownerId ?? 'sem_responsavel'}`
    const groups = groupsByOrder.get(row.ordem_id) ?? new Set<string>()
    groups.add(groupingKey)
    groupsByOrder.set(row.ordem_id, groups)

    if (groups.size > 1) {
      duplicatedGroupsByOrder.set(row.ordem_id, {
        ordemCodigo: row.ordem_codigo,
        groups,
      })
    }

    if (!routeResult.ownerId) continue
    if (row.responsavel_atual_id === routeResult.ownerId) continue
    if (conflictNotaIds.has(row.nota_id)) continue

    const existing = pendingByNota.get(row.nota_id)
    if (existing) {
      if (existing.administradorDestinoId === routeResult.ownerId) continue

      conflictNotaIds.add(row.nota_id)
      pendingByNota.delete(row.nota_id)
      continue
    }

    pendingByNota.set(row.nota_id, {
      notaId: row.nota_id,
      administradorDestinoId: routeResult.ownerId,
      ordemCodigo: row.ordem_codigo,
      tipoOrdem: row.tipo_ordem ?? null,
      unidade: row.unidade,
      responsavelAnteriorId: row.responsavel_atual_id,
      responsavelAnteriorNome: row.responsavel_atual_nome,
      responsavelNovoNome: destinationNameByAdminId.get(routeResult.ownerId) ?? routeResult.ownerId,
      origem: routeResult.reason,
      pagina: routeResult.page,
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
        p_motivo: motivo ?? 'Auto realocação PMPL/Refrigeração/CD (Painel de Ordens)',
      })

      if (error) throw error
      movedCount += ((data ?? []) as Array<{ nota_id: string }>).length
    }
  }

  if (debug) {
    const duplicatedGroupsSample = Array.from(duplicatedGroupsByOrder.values())
      .slice(0, 5)
      .map((item) => ({
        ordem_codigo: item.ordemCodigo,
        grupos: Array.from(item.groups),
      }))

    console.log('[DEBUG orders/routing] detectadas_por_pagina:', JSON.stringify(detectedByPage))
    console.log('[DEBUG orders/routing] detectadas_por_regra:', JSON.stringify(detectedByReason))
    console.log('[DEBUG orders/routing] detectadas_por_unidade:', JSON.stringify(detectedByUnit))
    console.log('[DEBUG orders/routing] palavras_chave_refrigeracao:', refrigeracaoKeywords.length)
    console.log('[DEBUG orders/routing] notas_pendentes:', pendingList.length)
    console.log('[DEBUG orders/routing] notas_com_conflito:', conflictNotaIds.size)
    console.log('[DEBUG orders/routing] notas_conflito_amostra:', JSON.stringify(Array.from(conflictNotaIds).slice(0, 5)))
    console.log('[DEBUG orders/routing] notas_reatribuidas:', movedCount)
    if (duplicatedGroupsByOrder.size > 0) {
      console.error('[DEBUG orders/routing] ordens_em_mais_de_um_grupo:', JSON.stringify(duplicatedGroupsSample))
    }
    console.log(
      '[DEBUG orders/routing] amostra_reatribuicoes:',
      JSON.stringify(
        pendingList.slice(0, 5).map((item) => ({
          ordem_codigo: item.ordemCodigo,
          tipo_ordem: item.tipoOrdem,
          pagina: item.pagina,
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
    detectedPmpl: detectedByPage.PMPL,
    detectedByUnit,
    fixedOwnerLabelByAdminId,
    pmplResolution,
  }
}
