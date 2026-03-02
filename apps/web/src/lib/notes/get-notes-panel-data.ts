import 'server-only'

import type { CurrentAdminContext } from '@/lib/auth/current-admin-context'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import { isOpenStatus } from '@/lib/collaborator/aging'
import { normalizeTextParam, readFirstParam } from '@/lib/grid/query'
import {
  applyOperationalStateToNota,
  toNotaOperacaoEstado,
} from '@/lib/notes/operational-state'
import { createClient } from '@/lib/supabase/server'
import type {
  CargaAdministrador,
  NotesKpiFilter,
  NotaPanelData,
  UserRole,
} from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'
const NOTA_OPERATIONAL_FIELDS = 'nota_id, numero_nota, status_operacional, em_geracao_por_admin_id, em_geracao_por_email, em_geracao_em, ultima_copia_em, ttl_minutos, numero_ordem_confirmada, confirmada_em, created_at, updated_at' as const
const VALID_NOTES_KPI: NotesKpiFilter[] = ['notas', 'novas', 'um_dia', 'dois_mais']
const OPEN_NOTES_STATUS_FILTERS = new Set(['abertas', 'nova', 'em_andamento', 'encaminhada_fornecedor'])
const GUSTAVO_EMAIL = 'gustavoandrade@bemol.com.br'
const OPERATIONAL_STATE_BATCH_SIZE = 500
const OPERATIONAL_STATE_PARALLELISM = 4

export interface NotesPageSearchParams {
  q?: string | string[]
  status?: string | string[]
  responsavel?: string | string[]
  unidade?: string | string[]
  kpi?: string | string[]
}

interface SelectOption {
  value: string
  label: string
}

export interface NotesPanelPageData {
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
  notasAtribuidas: NotaPanelData[]
  notasSemAtribuir: NotaPanelData[]
  kpis: {
    total: number
    novas: number
    umDia: number
    doisMais: number
  }
}

function normalizeNotesPanelStatusFilter(value: string): 'abertas' | 'nova' | 'em_andamento' | 'encaminhada_fornecedor' {
  if (OPEN_NOTES_STATUS_FILTERS.has(value)) {
    return value as 'abertas' | 'nova' | 'em_andamento' | 'encaminhada_fornecedor'
  }
  return 'abertas'
}

function toCargaCollaboratorData(c: CargaAdministrador, notas: NotaPanelData[]): CollaboratorData {
  const adminNotas = notas.filter((n) => n.administrador_id === c.id)
  const aging = buildAgingCounts(adminNotas)

  return {
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    max_notas: c.max_notas,
    avatar_url: c.avatar_url,
    especialidade: c.especialidade,
    recebe_distribuicao: c.recebe_distribuicao,
    em_ferias: c.em_ferias,
    qtd_nova: c.qtd_nova,
    qtd_em_andamento: c.qtd_em_andamento,
    qtd_encaminhada: c.qtd_encaminhada,
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: c.qtd_abertas,
    qtd_concluidas: c.qtd_concluidas,
    qtd_acompanhamento_ordens: c.qtd_ordens_ativas ?? 0,
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

async function loadOperationalStateByNotaId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noteIds: string[],
): Promise<Map<string, NonNullable<ReturnType<typeof toNotaOperacaoEstado>>>> {
  const operationalByNotaId = new Map<string, NonNullable<ReturnType<typeof toNotaOperacaoEstado>>>()
  if (noteIds.length === 0) return operationalByNotaId

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
      if (result.error) continue

      for (const row of (result.data ?? [])) {
        const normalized = toNotaOperacaoEstado((row ?? {}) as Record<string, unknown>)
        if (!normalized) continue
        operationalByNotaId.set(normalized.nota_id, normalized)
      }
    }
  }

  return operationalByNotaId
}

export async function getNotesPanelData(params: {
  searchParams?: NotesPageSearchParams
  currentAdminContext: Pick<CurrentAdminContext, 'adminId' | 'role' | 'canViewGlobal'>
}): Promise<NotesPanelPageData> {
  const supabase = await createClient()
  const currentAdminId = params.currentAdminContext.adminId
  const currentAdminRole = params.currentAdminContext.role
  const canViewGlobal = params.currentAdminContext.canViewGlobal

  const q = normalizeTextParam(readFirstParam(params.searchParams?.q))
  const status = normalizeNotesPanelStatusFilter(normalizeTextParam(readFirstParam(params.searchParams?.status)))
  const responsavel = normalizeTextParam(readFirstParam(params.searchParams?.responsavel))
  const unidade = normalizeTextParam(readFirstParam(params.searchParams?.unidade))
  const kpiRaw = normalizeTextParam(readFirstParam(params.searchParams?.kpi))
  const activeNotesKpi = VALID_NOTES_KPI.includes(kpiRaw as NotesKpiFilter)
    ? (kpiRaw as NotesKpiFilter)
    : null

  const [cargaResult, adminsResult] = await Promise.all([
    supabase.from('vw_carga_real_administradores').select('*').order('nome'),
    supabase
      .from('administradores')
      .select('id, nome')
      .eq('role', 'admin')
      .order('nome'),
  ])

  const preloadError = [cargaResult.error, adminsResult.error].find(Boolean)
  if (preloadError) throw preloadError

  let notesQuery = supabase
    .from('vw_notas_sem_ordem')
    .select(NOTA_FIELDS)
    .order('data_criacao_sap', { ascending: true })

  if (!canViewGlobal) {
    if (!currentAdminId) {
      notesQuery = notesQuery.eq('administrador_id', EMPTY_UUID)
    } else {
      notesQuery = notesQuery.eq('administrador_id', currentAdminId)
    }
  } else if (responsavel && responsavel !== 'todos') {
    if (responsavel === 'sem_atribuir') {
      notesQuery = notesQuery.is('administrador_id', null)
    } else {
      notesQuery = notesQuery.eq('administrador_id', responsavel)
    }
  }

  if (status === 'abertas') {
    notesQuery = notesQuery.in('status', ['nova', 'em_andamento', 'encaminhada_fornecedor'])
  } else {
    notesQuery = notesQuery.eq('status', status)
  }

  if (unidade && unidade !== 'todas') {
    notesQuery = notesQuery.eq('centro', unidade)
  }

  if (q) {
    const escaped = q.replace(/[%_]/g, '')
    notesQuery = notesQuery.or(`numero_nota.ilike.%${escaped}%,descricao.ilike.%${escaped}%`)
  }

  const notesResult = await notesQuery.limit(5000)
  if (notesResult.error) throw notesResult.error

  const allCarga = (cargaResult.data ?? []) as CargaAdministrador[]
  const operationalAdminIds = new Set(
    ((adminsResult.data ?? []) as Array<{ id: string }>).map((admin) => admin.id)
  )
  const operationalCarga = allCarga.filter((admin) => operationalAdminIds.has(admin.id))
  const notasFiltradasBase = (notesResult.data ?? []) as NotaPanelData[]
  const noteIds = notasFiltradasBase.map((nota) => nota.id)
  const operationalByNotaId = await loadOperationalStateByNotaId(supabase, noteIds)

  const notasFiltradas = notasFiltradasBase.map((nota) => {
    const state = operationalByNotaId.get(nota.id) ?? null
    return applyOperationalStateToNota(nota, state)
  })

  const notasAtribuidas = notasFiltradas.filter((nota) => Boolean(nota.administrador_id))
  const notasSemAtribuir = notasFiltradas.filter((nota) => !nota.administrador_id)
  const notaAdminIds = new Set(
    notasAtribuidas.map((nota) => nota.administrador_id).filter(Boolean) as string[]
  )
  const carga = operationalCarga.filter((admin) => {
    if (!canViewGlobal) return currentAdminId ? admin.id === currentAdminId : false

    return (
      admin.recebe_distribuicao
      || !admin.ativo
      || admin.em_ferias
      || admin.qtd_abertas > 0
      || notaAdminIds.has(admin.id)
    ) && admin.email !== GUSTAVO_EMAIL
  })

  const collaborators = [...carga]
    .sort((a, b) => {
      const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
      const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
      if (aOk && !bOk) return -1
      if (!aOk && bOk) return 1
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
    .map((item) => toCargaCollaboratorData(item, notasAtribuidas))

  const baseOpenNotas = notasFiltradas.filter((nota) => isOpenStatus(nota.status))
  const aging = buildAgingCounts(baseOpenNotas)

  const responsavelOptions: SelectOption[] = [
    { value: 'todos', label: 'Todos os responsáveis' },
    ...((adminsResult.data ?? []).map((admin) => ({ value: admin.id, label: admin.nome }))),
    { value: 'sem_atribuir', label: 'Não atribuídas' },
  ]

  const unidadeOptions: SelectOption[] = [
    { value: 'todas', label: 'Todas as unidades' },
    ...Array.from(new Set(notasFiltradas.map((nota) => nota.centro).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((centro) => ({ value: centro, label: centro })),
  ]

  return {
    currentAdminId,
    currentAdminRole,
    canViewGlobal,
    activeNotesKpi,
    initialSearch: q,
    initialStatus: status,
    initialResponsavel: responsavel,
    initialUnidade: unidade,
    responsavelOptions,
    unidadeOptions,
    collaborators,
    notasAtribuidas,
    notasSemAtribuir,
    kpis: {
      total: baseOpenNotas.length,
      novas: aging.qtd_novo,
      umDia: aging.qtd_1_dia,
      doisMais: aging.qtd_2_mais,
    },
  }
}
