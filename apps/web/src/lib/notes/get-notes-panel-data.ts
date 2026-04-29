import 'server-only'

import {
  isFixedCdOwnerEmail,
  isPmplFallbackOwnerEmail,
  resolveFixedOwnerKeyByUnit,
} from '@/lib/admin/admin-identity-catalog'
import type { CurrentAdminContext } from '@/lib/auth/current-admin-context'
import { isOpenStatus } from '@/lib/collaborator/aging'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import { toCollaboratorData } from '@/lib/collaborator/to-collaborator-data'
import { normalizeTextParam, readFirstParam } from '@/lib/grid/query'
import {
  applyOperationalStateToNota,
  toNotaOperacaoEstado,
} from '@/lib/notes/operational-state'
import { createClient } from '@/lib/supabase/server'
import type {
  CargaAdministrador,
  NotesKpiFilter,
  NotaLookupResult,
  NotaPanelData,
  UserRole,
} from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, denominacao_unidade, data_criacao_sap, created_at, equipamento_critico' as const
const NOTE_SUMMARY_FIELDS = 'id, status, administrador_id, centro, denominacao_unidade, data_criacao_sap, created_at' as const
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'
const NOTA_OPERATIONAL_FIELDS = 'nota_id, numero_nota, status_operacional, em_geracao_por_admin_id, em_geracao_por_email, em_geracao_em, ultima_copia_em, ttl_minutos, numero_ordem_confirmada, confirmada_em, created_at, updated_at' as const
const VALID_NOTES_KPI: NotesKpiFilter[] = ['notas', 'novas', 'um_dia', 'dois_mais']
const OPEN_NOTES_STATUS_FILTERS = new Set(['abertas', 'nova', 'em_andamento', 'encaminhada_fornecedor'])
const OPERATIONAL_STATE_BATCH_SIZE = 500
const OPERATIONAL_STATE_PARALLELISM = 4
const NOTES_PANEL_FETCH_CHUNK_SIZE = 1000
const NOTES_PANEL_LIST_LIMIT = 5000

interface SelectOption {
  value: string
  label: string
}

type SummaryNoteRow = Pick<NotaPanelData, 'id' | 'status' | 'administrador_id' | 'centro' | 'denominacao_unidade' | 'data_criacao_sap' | 'created_at'>

interface NormalizedNotesPanelFilters {
  q: string
  status: 'abertas' | 'nova' | 'em_andamento' | 'encaminhada_fornecedor'
  responsavel: string
  unidade: string
  activeNotesKpi: NotesKpiFilter | null
}

export interface NotesPageSearchParams {
  q?: string | string[]
  status?: string | string[]
  responsavel?: string | string[]
  unidade?: string | string[]
  kpi?: string | string[]
}

interface NotesPanelBaseParams {
  searchParams?: NotesPageSearchParams
  currentAdminContext: Pick<CurrentAdminContext, 'adminId' | 'role' | 'canViewGlobal'>
}

interface NotesPanelSupportingData {
  currentAdminId: string | null
  currentAdminRole: UserRole | null
  canViewGlobal: boolean
  filters: NormalizedNotesPanelFilters
  admins: Array<{ id: string; nome: string }>
  allCarga: CargaAdministrador[]
  hiddenCdOwnerIds: Set<string>
  operationalCarga: CargaAdministrador[]
  lookupNota: NotaLookupResult | null
  teamStats: {
    totalAtivos: number
    recebendo: number
    emFerias: number
    inativos: number
  }
}

interface NotesPanelLoaderParams extends NotesPanelBaseParams {
  supportingData?: Promise<NotesPanelSupportingData>
}

export interface NotesPanelSummaryData {
  currentAdminId: string | null
  currentAdminRole: UserRole | null
  canViewGlobal: boolean
  activeNotesKpi: NotesKpiFilter | null
  initialSearch: string
  initialStatus: string
  initialResponsavel: string
  initialUnidade: string
  responsavelOptions: SelectOption[]
  unidadeOptions: SelectOption[]
  collaborators: CollaboratorData[]
  unassignedCollaborator: CollaboratorData | null
  filteredNotesCount: number
  kpis: {
    total: number
    novas: number
    umDia: number
    doisMais: number
  }
  lookupNota: NotaLookupResult | null
  teamStats: {
    totalAtivos: number
    recebendo: number
    emFerias: number
    inativos: number
  }
}

export interface NotesPanelListData {
  notasAtribuidas: NotaPanelData[]
  notasSemAtribuir: NotaPanelData[]
  listIsPartial: boolean
  listLoadedCount: number
  listLimit: number
  operationalStateDegraded: boolean
}

export interface NotesPanelPageData extends NotesPanelSummaryData, NotesPanelListData {}

function getNotaUnidadeLabel(nota: Pick<NotaPanelData, 'centro' | 'denominacao_unidade'>): string | null {
  const denominacao = nota.denominacao_unidade?.trim()
  if (denominacao) return denominacao

  const centro = nota.centro?.trim()
  return centro || null
}

function normalizeNotesPanelStatusFilter(value: string): 'abertas' | 'nova' | 'em_andamento' | 'encaminhada_fornecedor' {
  if (OPEN_NOTES_STATUS_FILTERS.has(value)) {
    return value as 'abertas' | 'nova' | 'em_andamento' | 'encaminhada_fornecedor'
  }
  return 'abertas'
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function normalizePanelFilters(searchParams?: NotesPageSearchParams): NormalizedNotesPanelFilters {
  const q = normalizeTextParam(readFirstParam(searchParams?.q))
  const status = normalizeNotesPanelStatusFilter(normalizeTextParam(readFirstParam(searchParams?.status)))
  const responsavel = normalizeTextParam(readFirstParam(searchParams?.responsavel))
  const unidade = normalizeTextParam(readFirstParam(searchParams?.unidade))
  const kpiRaw = normalizeTextParam(readFirstParam(searchParams?.kpi))
  const activeNotesKpi = VALID_NOTES_KPI.includes(kpiRaw as NotesKpiFilter)
    ? (kpiRaw as NotesKpiFilter)
    : null

  return { q, status, responsavel, unidade, activeNotesKpi }
}

function shouldIncludePanelNote(
  nota: Pick<NotaPanelData, 'administrador_id' | 'centro' | 'denominacao_unidade'>,
  hiddenCdOwnerIds: Set<string>,
): boolean {
  if (nota.administrador_id && hiddenCdOwnerIds.has(nota.administrador_id)) {
    return false
  }

  return resolveFixedOwnerKeyByUnit(getNotaUnidadeLabel(nota)) === null
}

function buildNotesPanelBaseQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  supportingData: NotesPanelSupportingData,
  fields: string,
) {
  let notesQuery = supabase
    .from('vw_notas_sem_ordem')
    .select(fields)
    .order('data_criacao_sap', { ascending: true })

  const { currentAdminId, canViewGlobal, filters } = supportingData

  if (!canViewGlobal) {
    if (!currentAdminId) {
      notesQuery = notesQuery.eq('administrador_id', EMPTY_UUID)
    } else {
      notesQuery = notesQuery.eq('administrador_id', currentAdminId)
    }
  } else if (filters.responsavel && filters.responsavel !== 'todos') {
    if (filters.responsavel === 'sem_atribuir') {
      notesQuery = notesQuery.is('administrador_id', null)
    } else {
      notesQuery = notesQuery.eq('administrador_id', filters.responsavel)
    }
  }

  if (filters.status === 'abertas') {
    notesQuery = notesQuery.in('status', ['nova', 'em_andamento', 'encaminhada_fornecedor'])
  } else {
    notesQuery = notesQuery.eq('status', filters.status)
  }

  if (filters.unidade && filters.unidade !== 'todas') {
    notesQuery = notesQuery.eq('centro', filters.unidade)
  }

  if (filters.q) {
    const escaped = filters.q.replace(/[%_]/g, '')
    notesQuery = notesQuery.or(`numero_nota.ilike.%${escaped}%,descricao.ilike.%${escaped}%`)
  }

  return notesQuery
}

async function fetchPanelNotes<T extends Pick<NotaPanelData, 'administrador_id' | 'centro' | 'denominacao_unidade'>>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  supportingData: NotesPanelSupportingData,
  fields: string,
  maxKeptRows?: number,
): Promise<{ rows: T[]; hasMore: boolean }> {
  const rows: T[] = []
  let hasMore = false
  let offset = 0

  while (true) {
    const result = await buildNotesPanelBaseQuery(supabase, supportingData, fields)
      .range(offset, offset + NOTES_PANEL_FETCH_CHUNK_SIZE - 1)

    if (result.error) throw result.error

    const batch = (result.data ?? []) as unknown as T[]
    for (const row of batch) {
      if (!shouldIncludePanelNote(row, supportingData.hiddenCdOwnerIds)) continue
      rows.push(row)

      if (maxKeptRows !== undefined && rows.length > maxKeptRows) {
        hasMore = true
        return { rows: rows.slice(0, maxKeptRows), hasMore }
      }
    }

    if (batch.length < NOTES_PANEL_FETCH_CHUNK_SIZE) {
      break
    }

    offset += NOTES_PANEL_FETCH_CHUNK_SIZE
  }

  return { rows, hasMore }
}

async function loadOperationalStateByNotaId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noteIds: string[],
): Promise<{
  operationalByNotaId: Map<string, NonNullable<ReturnType<typeof toNotaOperacaoEstado>>>
  degraded: boolean
}> {
  const operationalByNotaId = new Map<string, NonNullable<ReturnType<typeof toNotaOperacaoEstado>>>()
  if (noteIds.length === 0) {
    return { operationalByNotaId, degraded: false }
  }

  let degraded = false
  const batches = chunkArray(noteIds, OPERATIONAL_STATE_BATCH_SIZE)

  for (let index = 0; index < batches.length; index += OPERATIONAL_STATE_PARALLELISM) {
    const batchWindow = batches.slice(index, index + OPERATIONAL_STATE_PARALLELISM)
    const results = await Promise.all(
      batchWindow.map((batch) => (
        supabase
          .from('notas_operacao_estado')
          .select(NOTA_OPERATIONAL_FIELDS)
          .in('nota_id', batch)
      ))
    )

    for (const result of results) {
      if (result.error) {
        degraded = true
        console.error('[notes-panel] failed to load operational state batch', {
          code: result.error.code,
          message: result.error.message,
          details: result.error.details,
          hint: result.error.hint,
        })
        continue
      }

      for (const row of (result.data ?? [])) {
        const normalized = toNotaOperacaoEstado((row ?? {}) as Record<string, unknown>)
        if (!normalized) continue
        operationalByNotaId.set(normalized.nota_id, normalized)
      }
    }
  }

  return { operationalByNotaId, degraded }
}

function buildNotesByAdmin<T extends Pick<NotaPanelData, 'administrador_id'>>(
  notasAtribuidas: T[],
): Map<string, T[]> {
  const notesByAdmin = new Map<string, T[]>()

  for (const nota of notasAtribuidas) {
    if (!nota.administrador_id) continue
    const current = notesByAdmin.get(nota.administrador_id)
    if (current) {
      current.push(nota)
    } else {
      notesByAdmin.set(nota.administrador_id, [nota])
    }
  }

  return notesByAdmin
}

function buildUnassignedCollaborator(notasSemAtribuir: SummaryNoteRow[] | NotaPanelData[]): CollaboratorData | null {
  if (notasSemAtribuir.length === 0) return null

  const openNotas = notasSemAtribuir.filter((nota) => isOpenStatus(nota.status))
  const aging = buildAgingCounts(openNotas)

  return {
    id: 'sem-atribuir',
    nome: 'Não atribuídas',
    ativo: true,
    max_notas: 0,
    avatar_url: null,
    especialidade: 'geral',
    recebe_distribuicao: false,
    em_ferias: false,
    qtd_nova: openNotas.filter((nota) => nota.status === 'nova').length,
    qtd_em_andamento: openNotas.filter((nota) => nota.status === 'em_andamento').length,
    qtd_encaminhada: openNotas.filter((nota) => nota.status === 'encaminhada_fornecedor').length,
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: openNotas.length,
    qtd_concluidas: 0,
    qtd_acompanhamento_ordens: 0,
  }
}

export async function loadNotesPanelSupportingData(
  params: NotesPanelBaseParams,
): Promise<NotesPanelSupportingData> {
  const supabase = await createClient()
  const currentAdminId = params.currentAdminContext.adminId
  const currentAdminRole = params.currentAdminContext.role
  const canViewGlobal = params.currentAdminContext.canViewGlobal
  const filters = normalizePanelFilters(params.searchParams)
  const shouldLookup = Boolean(filters.q) && !canViewGlobal && Boolean(currentAdminId)

  const [cargaResult, adminsResult, lookupResult] = await Promise.all([
    supabase.from('vw_carga_real_administradores').select('*').order('nome'),
    supabase
      .from('administradores')
      .select('id, nome')
      .eq('role', 'admin')
      .order('nome'),
    shouldLookup
      ? supabase
          .rpc('buscar_nota_lookup_por_numero', {
            p_numero_nota: filters.q,
            p_requesting_admin_id: currentAdminId!,
          })
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const preloadError = [cargaResult.error, adminsResult.error].find(Boolean)
  if (preloadError) throw preloadError

  const allCarga = (cargaResult.data ?? []) as CargaAdministrador[]
  const admins = (adminsResult.data ?? []) as Array<{ id: string; nome: string }>
  const hiddenCdOwnerIds = new Set(
    allCarga
      .filter((admin) => isFixedCdOwnerEmail(admin.email))
      .map((admin) => admin.id)
  )
  const operationalAdminIds = new Set(admins.map((admin) => admin.id))
  const operationalCarga = allCarga.filter((admin) => operationalAdminIds.has(admin.id))

  return {
    currentAdminId,
    currentAdminRole,
    canViewGlobal,
    filters,
    admins,
    allCarga,
    hiddenCdOwnerIds,
    operationalCarga,
    lookupNota: (lookupResult.data as NotaLookupResult | null) ?? null,
    teamStats: {
      totalAtivos: operationalCarga.filter((admin) => admin.ativo).length,
      recebendo: operationalCarga.filter((admin) => admin.ativo && admin.recebe_distribuicao && !admin.em_ferias).length,
      emFerias: operationalCarga.filter((admin) => admin.em_ferias).length,
      inativos: operationalCarga.filter((admin) => !admin.ativo).length,
    },
  }
}

async function resolveSupportingData(params: NotesPanelLoaderParams): Promise<NotesPanelSupportingData> {
  return params.supportingData ? await params.supportingData : loadNotesPanelSupportingData(params)
}

export async function getNotesPanelSummaryData(
  params: NotesPanelLoaderParams,
): Promise<NotesPanelSummaryData> {
  const supportingData = await resolveSupportingData(params)
  const supabase = await createClient()
  const { rows: notasFiltradas } = await fetchPanelNotes<SummaryNoteRow>(
    supabase,
    supportingData,
    NOTE_SUMMARY_FIELDS,
  )

  const notasAtribuidas = notasFiltradas.filter((nota) => Boolean(nota.administrador_id))
  const notasSemAtribuir = notasFiltradas.filter((nota) => !nota.administrador_id)
  const notaAdminIds = new Set(
    notasAtribuidas.map((nota) => nota.administrador_id).filter(Boolean) as string[],
  )

  const carga = supportingData.operationalCarga.filter((admin) => {
    if (!supportingData.canViewGlobal) {
      return supportingData.currentAdminId ? admin.id === supportingData.currentAdminId : false
    }

    return (
      admin.ativo
      && !admin.em_ferias
      && (
        admin.recebe_distribuicao
        || admin.qtd_abertas > 0
        || notaAdminIds.has(admin.id)
      )
    )
    && !isPmplFallbackOwnerEmail(admin.email)
    && !isFixedCdOwnerEmail(admin.email)
  })

  const notasByAdmin = buildNotesByAdmin(notasAtribuidas)

  const collaborators = [...carga]
    .sort((a, b) => {
      const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
      const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
      if (aOk && !bOk) return -1
      if (!aOk && bOk) return 1
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
    .map((item) => toCollaboratorData(item, notasByAdmin.get(item.id) ?? []))

  const baseOpenNotas = notasFiltradas.filter((nota) => isOpenStatus(nota.status))
  const aging = buildAgingCounts(baseOpenNotas)

  const responsavelOptions: SelectOption[] = [
    { value: 'todos', label: 'Todos os responsáveis' },
    ...supportingData.admins
      .filter((admin) => !supportingData.hiddenCdOwnerIds.has(admin.id))
      .map((admin) => ({ value: admin.id, label: admin.nome })),
    { value: 'sem_atribuir', label: 'Não atribuídas' },
  ]

  const unidadeOptions: SelectOption[] = [
    { value: 'todas', label: 'Todas as unidades' },
    ...Array.from(
      new Map(
        notasFiltradas
          .map((nota) => {
            const centro = nota.centro?.trim()
            if (!centro) return null
            return [centro, getNotaUnidadeLabel(nota) ?? centro] as const
          })
          .filter(Boolean) as ReadonlyArray<readonly [string, string]>
      ).entries()
    )
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([centro, label]) => ({ value: centro, label })),
  ]

  return {
    currentAdminId: supportingData.currentAdminId,
    currentAdminRole: supportingData.currentAdminRole,
    canViewGlobal: supportingData.canViewGlobal,
    activeNotesKpi: supportingData.filters.activeNotesKpi,
    initialSearch: supportingData.filters.q,
    initialStatus: supportingData.filters.status,
    initialResponsavel: supportingData.filters.responsavel,
    initialUnidade: supportingData.filters.unidade,
    responsavelOptions,
    unidadeOptions,
    collaborators,
    unassignedCollaborator: buildUnassignedCollaborator(notasSemAtribuir),
    filteredNotesCount: notasFiltradas.length,
    kpis: {
      total: baseOpenNotas.length,
      novas: aging.qtd_novo,
      umDia: aging.qtd_1_dia,
      doisMais: aging.qtd_2_mais,
    },
    lookupNota: supportingData.lookupNota,
    teamStats: supportingData.teamStats,
  }
}

export async function getNotesPanelListData(
  params: NotesPanelLoaderParams,
): Promise<NotesPanelListData> {
  const supportingData = await resolveSupportingData(params)
  const supabase = await createClient()
  const { rows: notasFiltradasBase, hasMore } = await fetchPanelNotes<NotaPanelData>(
    supabase,
    supportingData,
    NOTA_FIELDS,
    NOTES_PANEL_LIST_LIMIT,
  )

  const noteIds = notasFiltradasBase.map((nota) => nota.id)
  const { operationalByNotaId, degraded } = await loadOperationalStateByNotaId(supabase, noteIds)

  const notasFiltradas = notasFiltradasBase.map((nota) => {
    const state = operationalByNotaId.get(nota.id) ?? null
    return applyOperationalStateToNota(nota, state)
  })

  notasFiltradas.sort((a, b) => {
    const aCritical = a.equipamento_critico ? 1 : 0
    const bCritical = b.equipamento_critico ? 1 : 0
    return bCritical - aCritical
  })

  return {
    notasAtribuidas: notasFiltradas.filter((nota) => Boolean(nota.administrador_id)),
    notasSemAtribuir: notasFiltradas.filter((nota) => !nota.administrador_id),
    listIsPartial: hasMore,
    listLoadedCount: notasFiltradas.length,
    listLimit: NOTES_PANEL_LIST_LIMIT,
    operationalStateDegraded: degraded,
  }
}

export async function getNotesPanelData(params: NotesPanelBaseParams): Promise<NotesPanelPageData> {
  const supportingData = loadNotesPanelSupportingData(params)
  const [summaryData, listData] = await Promise.all([
    getNotesPanelSummaryData({ ...params, supportingData }),
    getNotesPanelListData({ ...params, supportingData }),
  ])

  return {
    ...summaryData,
    ...listData,
  }
}
