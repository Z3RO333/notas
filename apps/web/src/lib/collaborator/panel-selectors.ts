import { withCollaboratorDisplayMetrics } from '@/lib/collaborator/display-metrics'
import { matchNotesKpi } from '@/lib/collaborator/metrics'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotesKpiFilter, NotaPanelData } from '@/lib/types/database'

type StatusScope = 'default' | 'open_only'

interface CollaboratorPanelStructuralFilters {
  statusFilter: string
  statusScope: StatusScope
  unidadeFilter: string
  activeNotesKpi: NotesKpiFilter | null
}

interface CollaboratorPanelVisibilityFilters {
  normalizedSearch: string
  showResponsavelFilter: boolean
  responsavelFilter: string
}

interface CollaboratorBaseDerivedState {
  baseFilteredNotasByAdmin: Map<string, NotaPanelData[]>
  baseFilteredNotasSemAtribuir: NotaPanelData[]
  baseDisplayCollaborators: CollaboratorData[]
}

interface DeriveCollaboratorBaseStateParams {
  collaborators: CollaboratorData[]
  notas: NotaPanelData[]
  notasSemAtribuir: NotaPanelData[]
  filters: CollaboratorPanelStructuralFilters
  shouldUseCanonicalMetrics: boolean
}

interface DeriveCollaboratorVisibleStateParams {
  collaborators: CollaboratorData[]
  baseState: CollaboratorBaseDerivedState
  structuralFilters: CollaboratorPanelStructuralFilters
  visibilityFilters: CollaboratorPanelVisibilityFilters
  shouldUseCanonicalMetrics: boolean
}

interface CollectVisibleNotesForEmCampoParams {
  filteredNotasByAdmin: Map<string, NotaPanelData[]>
  filteredNotasSemAtribuir: NotaPanelData[]
  visibleCollaborators: CollaboratorData[]
  showResponsavelFilter: boolean
  responsavelFilter: string
}

function buildCollaboratorBuckets(collaborators: CollaboratorData[]): Map<string, NotaPanelData[]> {
  return new Map(collaborators.map((collaborator) => [collaborator.id, [] as NotaPanelData[]]))
}

function matchesStructuralFilters(
  nota: NotaPanelData,
  filters: CollaboratorPanelStructuralFilters,
): boolean {
  if (filters.statusFilter === 'abertas') {
    if (nota.status === 'concluida' || nota.status === 'cancelada') return false
  } else if (filters.statusScope === 'open_only') {
    if (
      nota.status !== 'nova'
      && nota.status !== 'em_andamento'
      && nota.status !== 'encaminhada_fornecedor'
    ) {
      return false
    }
  } else if (filters.statusFilter !== 'todas' && nota.status !== filters.statusFilter) {
    return false
  }

  if (
    filters.unidadeFilter
    && filters.unidadeFilter !== 'todas'
    && (nota.centro ?? '') !== filters.unidadeFilter
  ) {
    return false
  }

  if (filters.activeNotesKpi && !matchNotesKpi(nota, filters.activeNotesKpi)) {
    return false
  }

  return true
}

function matchesSearch(nota: NotaPanelData, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true

  return (
    nota.numero_nota.toLowerCase().includes(normalizedSearch)
    || nota.descricao.toLowerCase().includes(normalizedSearch)
  )
}

export function deriveCollaboratorBaseState({
  collaborators,
  notas,
  notasSemAtribuir,
  filters,
  shouldUseCanonicalMetrics,
}: DeriveCollaboratorBaseStateParams): CollaboratorBaseDerivedState {
  const baseFilteredNotasByAdmin = buildCollaboratorBuckets(collaborators)

  for (const nota of notas) {
    if (!nota.administrador_id || !matchesStructuralFilters(nota, filters)) continue

    const list = baseFilteredNotasByAdmin.get(nota.administrador_id)
    if (list) {
      list.push(nota)
    }
  }

  const baseFilteredNotasSemAtribuir = notasSemAtribuir.filter((nota) => (
    matchesStructuralFilters(nota, filters)
  ))

  const baseDisplayCollaborators = shouldUseCanonicalMetrics
    ? collaborators
    : collaborators.map((collaborator) => (
      withCollaboratorDisplayMetrics(
        collaborator,
        baseFilteredNotasByAdmin.get(collaborator.id) ?? [],
      )
    ))

  return {
    baseFilteredNotasByAdmin,
    baseFilteredNotasSemAtribuir,
    baseDisplayCollaborators,
  }
}

export function deriveCollaboratorVisibleState({
  collaborators,
  baseState,
  structuralFilters,
  visibilityFilters,
  shouldUseCanonicalMetrics,
}: DeriveCollaboratorVisibleStateParams) {
  let filteredNotasByAdmin = baseState.baseFilteredNotasByAdmin
  let filteredNotasSemAtribuir = baseState.baseFilteredNotasSemAtribuir

  if (visibilityFilters.normalizedSearch) {
    filteredNotasByAdmin = buildCollaboratorBuckets(collaborators)

    for (const collaborator of collaborators) {
      const filtered = (baseState.baseFilteredNotasByAdmin.get(collaborator.id) ?? []).filter((nota) => (
        matchesSearch(nota, visibilityFilters.normalizedSearch)
      ))
      filteredNotasByAdmin.set(collaborator.id, filtered)
    }

    filteredNotasSemAtribuir = baseState.baseFilteredNotasSemAtribuir.filter((nota) => (
      matchesSearch(nota, visibilityFilters.normalizedSearch)
    ))
  }

  let visibleCollaborators = shouldUseCanonicalMetrics
    ? baseState.baseDisplayCollaborators
    : visibilityFilters.normalizedSearch
      ? collaborators.map((collaborator) => (
        withCollaboratorDisplayMetrics(
          collaborator,
          filteredNotasByAdmin.get(collaborator.id) ?? [],
        )
      ))
      : baseState.baseDisplayCollaborators

  if (
    visibilityFilters.showResponsavelFilter
    && visibilityFilters.responsavelFilter
    && visibilityFilters.responsavelFilter !== 'todos'
  ) {
    visibleCollaborators = visibilityFilters.responsavelFilter === 'sem_atribuir'
      ? []
      : visibleCollaborators.filter((collaborator) => (
        collaborator.id === visibilityFilters.responsavelFilter
      ))
  }

  const hasActiveFilter = Boolean(
    visibilityFilters.normalizedSearch
    || (structuralFilters.statusFilter && structuralFilters.statusFilter !== 'abertas')
    || (structuralFilters.unidadeFilter && structuralFilters.unidadeFilter !== 'todas')
    || structuralFilters.activeNotesKpi
    || (
      visibilityFilters.showResponsavelFilter
      && visibilityFilters.responsavelFilter
      && visibilityFilters.responsavelFilter !== 'todos'
    )
  )

  if (hasActiveFilter) {
    visibleCollaborators = visibleCollaborators.filter((collaborator) => (
      (filteredNotasByAdmin.get(collaborator.id) ?? []).length > 0
    ))
  }

  return {
    filteredNotasByAdmin,
    filteredNotasSemAtribuir,
    visibleCollaborators,
  }
}

export function collectVisibleNotesForEmCampo({
  filteredNotasByAdmin,
  filteredNotasSemAtribuir,
  visibleCollaborators,
  showResponsavelFilter,
  responsavelFilter,
}: CollectVisibleNotesForEmCampoParams): NotaPanelData[] {
  const notesMap = new Map<string, NotaPanelData>()

  if (showResponsavelFilter && responsavelFilter === 'sem_atribuir') {
    for (const nota of filteredNotasSemAtribuir) {
      notesMap.set(nota.id, nota)
    }
    return Array.from(notesMap.values())
  }

  for (const collaborator of visibleCollaborators) {
    for (const nota of filteredNotasByAdmin.get(collaborator.id) ?? []) {
      notesMap.set(nota.id, nota)
    }
  }

  if (!showResponsavelFilter || responsavelFilter === 'todos') {
    for (const nota of filteredNotasSemAtribuir) {
      notesMap.set(nota.id, nota)
    }
  }

  return Array.from(notesMap.values())
}
