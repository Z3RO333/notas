'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, Rows3, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import {
  collectVisibleNotesForEmCampo,
  deriveCollaboratorBaseState,
  deriveCollaboratorVisibleState,
} from '@/lib/collaborator/panel-selectors'
import { CollaboratorMiniCard } from './collaborator-mini-card'
import { CollaboratorAccordion } from './collaborator-accordion'
import { CollaboratorAdminActions } from './collaborator-admin-actions'
import { CollaboratorFullCard } from './collaborator-full-card'
import { TrackingOrdersBlock } from './tracking-orders-block'
import { NotesEmCampoDialog } from '@/components/notas/notes-em-campo-dialog'
import { listenNotaOperacaoEvent } from '@/lib/notes/copy-intent'
import {
  applyOperationalStateToNota,
  clearOperationalStateFromNota,
  toNotaOperacaoEstado,
} from '@/lib/notes/operational-state'
import type {
  CollaboratorData,
  NotesViewMode,
  TrackingPositionMode,
} from '@/lib/types/collaborator'
import type {
  NotaOperacaoEstado,
  NotesKpiFilter,
  NotaPanelData,
  OrdemAcompanhamento,
} from '@/lib/types/database'
import { updateSearchParams } from '@/lib/grid/query'
import { createClient } from '@/lib/supabase/client'

interface CollaboratorPanelProps {
  collaborators: CollaboratorData[]
  notas: NotaPanelData[]
  mode: 'viewer' | 'admin'
  notasSemAtribuir?: NotaPanelData[]
  canonicalUnassignedCollaborator?: CollaboratorData | null
  currentAdminId?: string | null
  currentAdminRole?: string | null
  ordensAcompanhamento?: OrdemAcompanhamento[]
  syncWithUrl?: boolean
  initialSearch?: string
  initialStatus?: string
  initialResponsavel?: string
  initialUnidade?: string
  responsavelOptions?: Array<{ value: string; label: string }>
  unidadeOptions?: Array<{ value: string; label: string }>
  showResponsavelFilter?: boolean
  showUnidadeFilter?: boolean
  statusScope?: 'default' | 'open_only'
  activeNotesKpi?: NotesKpiFilter | null
  preferCanonicalCollaboratorMetrics?: boolean
  resultsArePartial?: boolean
  totalNotesCount?: number
  loadedNotesCount?: number
  operationalStateDegraded?: boolean
}

const VIEW_MODE_STORAGE_KEY = 'cockpit:panel:view-mode'
const TRACKING_POSITION_STORAGE_KEY = 'cockpit:panel:tracking-position'

type DestinationOption = { id: string; nome: string; qtd_abertas: number }

function resolveOperationalOverrides(
  notas: NotaPanelData[],
  operationalOverridesByNotaId: Map<string, NotaOperacaoEstado | 'clear'>,
): NotaPanelData[] {
  if (operationalOverridesByNotaId.size === 0) return notas

  let changed = false
  const resolved = notas.map((nota) => {
    const override = operationalOverridesByNotaId.get(nota.id)
    if (!override) return nota
    changed = true
    return override === 'clear'
      ? clearOperationalStateFromNota(nota)
      : applyOperationalStateToNota(nota, override)
  })

  return changed ? resolved : notas
}

export function CollaboratorPanel({
  collaborators,
  notas,
  mode,
  notasSemAtribuir,
  canonicalUnassignedCollaborator = null,
  currentAdminId,
  currentAdminRole,
  ordensAcompanhamento = [],
  syncWithUrl = false,
  initialSearch = '',
  initialStatus = '',
  initialResponsavel = '',
  initialUnidade = '',
  responsavelOptions = [],
  unidadeOptions = [],
  showResponsavelFilter = false,
  showUnidadeFilter = false,
  statusScope = 'default',
  activeNotesKpi = null,
  preferCanonicalCollaboratorMetrics = false,
  resultsArePartial = false,
  totalNotesCount,
  loadedNotesCount,
  operationalStateDegraded = false,
}: CollaboratorPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState(initialStatus || 'abertas')
  const [responsavelFilter, setResponsavelFilter] = useState(initialResponsavel || 'todos')
  const [unidadeFilter, setUnidadeFilter] = useState(initialUnidade || 'todas')
  const [viewMode, setViewMode] = useState<NotesViewMode>('list')
  const [trackingPosition, setTrackingPosition] = useState<TrackingPositionMode>('top')
  const [operationalOverridesByNotaId, setOperationalOverridesByNotaId] = useState<
    Map<string, NotaOperacaoEstado | 'clear'>
  >(() => new Map())

  useEffect(() => {
    setOperationalOverridesByNotaId(new Map())
  }, [notas, notasSemAtribuir])

  useEffect(() => {
    function setOperationalOverride(
      notaId: string,
      mode: 'apply' | 'clear',
      row: Record<string, unknown> | null,
    ) {
      setOperationalOverridesByNotaId((prev) => {
        const next = new Map(prev)
        if (mode === 'clear') {
          next.set(notaId, 'clear')
        } else {
          next.set(notaId, toNotaOperacaoEstado(row) ?? 'clear')
        }
        return next
      })
    }

    const channel = supabase
      .channel('notas-operacao-estado-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notas_operacao_estado',
        },
        (payload) => {
          const raw = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
          const notaId = typeof raw?.nota_id === 'string' ? raw.nota_id : null
          if (!notaId) return

          const mode = payload.eventType === 'DELETE' ? 'clear' : 'apply'
          setOperationalOverride(notaId, mode, raw)
        },
      )
      .subscribe()

    const unsubscribeLocalEvent = listenNotaOperacaoEvent(({ notaId, state }) => {
      const row = state ? (state as unknown as Record<string, unknown>) : null
      const mode: 'apply' | 'clear' = state ? 'apply' : 'clear'
      setOperationalOverride(notaId, mode, row)
    })

    return () => {
      unsubscribeLocalEvent()
      supabase.removeChannel(channel)
    }
  }, [supabase])

  useEffect(() => {
    setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    setStatusFilter(initialStatus || 'abertas')
  }, [initialStatus])

  useEffect(() => {
    setResponsavelFilter(initialResponsavel || 'todos')
  }, [initialResponsavel])

  useEffect(() => {
    setUnidadeFilter(initialUnidade || 'todas')
  }, [initialUnidade])

  useEffect(() => {
    const persistedViewMode = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    const persistedTrackingPosition = window.localStorage.getItem(TRACKING_POSITION_STORAGE_KEY)
    if (persistedViewMode === 'list' || persistedViewMode === 'cards') {
      setViewMode(persistedViewMode)
    }
    if (persistedTrackingPosition === 'top' || persistedTrackingPosition === 'inside' || persistedTrackingPosition === 'both') {
      setTrackingPosition(persistedTrackingPosition)
    }
  }, [])

  const replaceQuery = useCallback((updates: Record<string, string | number | null | undefined>) => {
    if (!syncWithUrl) return
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), updates)
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }, [pathname, router, searchParams, syncWithUrl])

  useEffect(() => {
    if (!syncWithUrl) return
    const timer = setTimeout(() => {
      const normalized = search.trim()
      if (normalized === initialSearch) return
      replaceQuery({ q: normalized || null })
    }, 300)

    return () => clearTimeout(timer)
  }, [search, initialSearch, syncWithUrl, replaceQuery])

  function handleViewModeChange(value: string) {
    const next = value === 'cards' ? 'cards' : 'list'
    setViewMode(next)
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next)
  }

  function handleTrackingPositionChange(value: string) {
    const next: TrackingPositionMode =
      value === 'inside' ? 'inside' : value === 'both' ? 'both' : 'top'
    setTrackingPosition(next)
    window.localStorage.setItem(TRACKING_POSITION_STORAGE_KEY, next)
  }

  function handleStatusChange(value: string) {
    const nextStatus = statusScope === 'open_only'
      ? (value === 'nova' || value === 'em_andamento' || value === 'encaminhada_fornecedor' || value === 'abertas'
          ? value
          : 'abertas')
      : value

    setStatusFilter(nextStatus)
    if (syncWithUrl) {
      replaceQuery({ status: nextStatus === 'abertas' ? null : nextStatus })
    }
  }

  function handleResponsavelChange(value: string) {
    setResponsavelFilter(value)
    if (syncWithUrl) {
      replaceQuery({ responsavel: value === 'todos' ? null : value })
    }
  }

  function handleUnidadeChange(value: string) {
    setUnidadeFilter(value)
    if (syncWithUrl) {
      replaceQuery({ unidade: value === 'todas' ? null : value })
    }
  }

  const collaboratorById = useMemo(
    () => new Map(collaborators.map((collaborator) => [collaborator.id, collaborator])),
    [collaborators]
  )
  const unidadeLabelByValue = useMemo(
    () => new Map(unidadeOptions.map((option) => [option.value, option.label])),
    [unidadeOptions]
  )

  const resolvedNotas = useMemo(
    () => resolveOperationalOverrides(notas, operationalOverridesByNotaId),
    [notas, operationalOverridesByNotaId],
  )
  const resolvedNotasSemAtribuir = useMemo(
    () => resolveOperationalOverrides(notasSemAtribuir ?? [], operationalOverridesByNotaId),
    [notasSemAtribuir, operationalOverridesByNotaId],
  )
  const activeDestinationOptions = useMemo<DestinationOption[]>(
    () => collaborators
      .filter((item) => item.ativo && !item.em_ferias)
      .map((item) => ({ id: item.id, nome: item.nome, qtd_abertas: item.qtd_abertas })),
    [collaborators],
  )
  const deferredSearch = useDeferredValue(search)
  const normalizedSearch = deferredSearch.trim().toLowerCase()
  const shouldUseCanonicalMetrics = preferCanonicalCollaboratorMetrics && activeNotesKpi === null

  const structuralFilters = useMemo(() => ({
    statusFilter,
    statusScope,
    unidadeFilter,
    activeNotesKpi,
  }), [activeNotesKpi, statusFilter, statusScope, unidadeFilter])

  const baseDerivedState = useMemo(() => deriveCollaboratorBaseState({
    collaborators,
    notas: resolvedNotas,
    notasSemAtribuir: resolvedNotasSemAtribuir,
    filters: structuralFilters,
    shouldUseCanonicalMetrics,
  }), [
    collaborators,
    resolvedNotas,
    resolvedNotasSemAtribuir,
    shouldUseCanonicalMetrics,
    structuralFilters,
  ])

  const {
    filteredNotasByAdmin,
    filteredNotasSemAtribuir,
    visibleCollaborators,
  } = useMemo(() => deriveCollaboratorVisibleState({
    collaborators,
    baseState: baseDerivedState,
    structuralFilters,
    visibilityFilters: {
      normalizedSearch,
      showResponsavelFilter,
      responsavelFilter,
    },
    shouldUseCanonicalMetrics,
  }), [
    baseDerivedState,
    collaborators,
    normalizedSearch,
    responsavelFilter,
    shouldUseCanonicalMetrics,
    showResponsavelFilter,
    structuralFilters,
  ])

  const resolveVisibleNotesForEmCampo = useCallback(() => {
    return collectVisibleNotesForEmCampo({
      filteredNotasByAdmin,
      filteredNotasSemAtribuir,
      visibleCollaborators,
      showResponsavelFilter,
      responsavelFilter,
    })
  }, [
    filteredNotasByAdmin,
    filteredNotasSemAtribuir,
    responsavelFilter,
    showResponsavelFilter,
    visibleCollaborators,
  ])

  function handleCardClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const isAdminViewer = mode === 'viewer' && currentAdminRole === 'admin'
  const isGestorViewer = mode === 'viewer' && currentAdminRole === 'gestor'
  const isReadOnlyViewer = currentAdminRole === 'viewer'
  const shouldShowTrackingControls = isAdminViewer && ordensAcompanhamento.length > 0
  const showTopTracking = ordensAcompanhamento.length > 0
    && (isGestorViewer || trackingPosition === 'top' || trackingPosition === 'both')
  const showInsideTracking = isAdminViewer && (trackingPosition === 'inside' || trackingPosition === 'both')

  const semAtribuirCollaborator: CollaboratorData | null = useMemo(() => {
    if (shouldUseCanonicalMetrics) {
      return canonicalUnassignedCollaborator
    }
    if (!filteredNotasSemAtribuir || filteredNotasSemAtribuir.length === 0) return null
    const aging = buildAgingCounts(filteredNotasSemAtribuir)
    return {
      id: 'sem-atribuir',
      nome: 'Não atribuídas',
      ativo: true,
      max_notas: 0,
      avatar_url: null,
      especialidade: 'geral',
      recebe_distribuicao: false,
      em_ferias: false,
      qtd_nova: filteredNotasSemAtribuir.filter((n) => n.status === 'nova').length,
      qtd_em_andamento: filteredNotasSemAtribuir.filter((n) => n.status === 'em_andamento').length,
      qtd_encaminhada: filteredNotasSemAtribuir.filter((n) => n.status === 'encaminhada_fornecedor').length,
      qtd_novo: aging.qtd_novo,
      qtd_1_dia: aging.qtd_1_dia,
      qtd_2_mais: aging.qtd_2_mais,
      qtd_abertas: filteredNotasSemAtribuir.length,
      qtd_concluidas: 0,
      qtd_acompanhamento_ordens: 0,
    }
  }, [canonicalUnassignedCollaborator, filteredNotasSemAtribuir, shouldUseCanonicalMetrics])

  const activeFilterChips = [
    search ? { key: 'q', label: `Busca: ${search}` } : null,
    statusFilter && statusFilter !== 'abertas' ? { key: 'status', label: `Status: ${statusFilter}` } : null,
    showResponsavelFilter && responsavelFilter && responsavelFilter !== 'todos'
      ? { key: 'responsavel', label: 'Responsável' }
      : null,
    showUnidadeFilter && unidadeFilter && unidadeFilter !== 'todas'
      ? { key: 'unidade', label: `Unidade: ${unidadeLabelByValue.get(unidadeFilter) ?? unidadeFilter}` }
      : null,
    activeNotesKpi ? { key: 'kpi', label: `KPI: ${activeNotesKpi}` } : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>

  function clearFilter(filterKey: string) {
    if (filterKey === 'q') {
      setSearch('')
      replaceQuery({ q: null })
      return
    }
    if (filterKey === 'status') {
      handleStatusChange('abertas')
      return
    }
    if (filterKey === 'responsavel') {
      handleResponsavelChange('todos')
      return
    }
    if (filterKey === 'unidade') {
      handleUnidadeChange('todas')
      return
    }
    if (filterKey === 'kpi') {
      replaceQuery({ kpi: null })
    }
  }

  return (
    <div className="space-y-4">
      {resultsArePartial && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          {typeof totalNotesCount === 'number' && typeof loadedNotesCount === 'number' && totalNotesCount > loadedNotesCount
            ? `A lista detalhada carregou ${loadedNotesCount.toLocaleString('pt-BR')} de ${totalNotesCount.toLocaleString('pt-BR')} notas deste filtro. KPIs e cards seguem a contagem canônica; refine os filtros para navegar a carteira completa.`
            : 'A lista detalhada foi carregada de forma parcial. KPIs e cards seguem a contagem canônica; refine os filtros para navegar a carteira completa.'}
        </div>
      )}

      {operationalStateDegraded && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100">
          O estado operacional de algumas notas não pôde ser carregado agora. A carteira continua disponível, mas indicadores de geração podem aparecer incompletos até a próxima atualização.
        </div>
      )}

      {showTopTracking && (
        <TrackingOrdersBlock
          orders={ordensAcompanhamento}
          title={currentAdminRole === 'gestor' ? 'Ordens em acompanhamento (gestão)' : 'Minhas ordens em acompanhamento'}
        />
      )}

      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número ou descrição"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-full xl:w-44">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Abertas</SelectItem>
            <SelectItem value="nova">Novas</SelectItem>
            <SelectItem value="em_andamento">Em andamento</SelectItem>
            <SelectItem value="encaminhada_fornecedor">Encaminhadas</SelectItem>
            {statusScope === 'default' && (
              <SelectItem value="todas">Todas</SelectItem>
            )}
            {statusScope === 'default' && (
              <SelectItem value="concluida">Concluídas</SelectItem>
            )}
            {statusScope === 'default' && (
              <SelectItem value="cancelada">Canceladas</SelectItem>
            )}
          </SelectContent>
        </Select>

        {showResponsavelFilter && responsavelOptions.length > 0 && (
          <Select value={responsavelFilter} onValueChange={handleResponsavelChange}>
            <SelectTrigger className="w-full xl:w-56">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              {responsavelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showUnidadeFilter && unidadeOptions.length > 0 && (
          <Select value={unidadeFilter} onValueChange={handleUnidadeChange}>
            <SelectTrigger className="w-full xl:w-48">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              {unidadeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {mode === 'viewer' && !isReadOnlyViewer && (
          <NotesEmCampoDialog
            getNotes={resolveVisibleNotesForEmCampo}
            unidadeOptions={unidadeOptions}
            defaultUnidade={unidadeFilter}
          />
        )}

        <Select value={viewMode} onValueChange={handleViewModeChange}>
          <SelectTrigger className="w-full xl:w-48">
            <SelectValue placeholder="Visualização" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="list">
              <div className="flex items-center gap-2">
                <Rows3 className="h-4 w-4" />
                Lista vertical
              </div>
            </SelectItem>
            <SelectItem value="cards">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4" />
                Cards completos
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {shouldShowTrackingControls && (
          <Select value={trackingPosition} onValueChange={handleTrackingPositionChange}>
            <SelectTrigger className="w-full xl:w-48">
              <SelectValue placeholder="Acompanhamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Acompanhamento no topo</SelectItem>
              <SelectItem value="inside">Acompanhamento dentro</SelectItem>
              <SelectItem value="both">Acompanhamento em ambos</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50"
              onClick={() => clearFilter(chip.key)}
            >
              {chip.label} ×
            </button>
          ))}
        </div>
      )}

      {viewMode === 'list' ? (
        <>
          <div className="sticky top-14 z-40 bg-background/95 pb-3 pt-1 backdrop-blur">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {visibleCollaborators.map((c) => (
                <CollaboratorMiniCard
                  key={c.id}
                  collaborator={c}
                  isExpanded={expandedId === c.id}
                  onClick={() => handleCardClick(c.id)}
                />
              ))}

              {mode === 'viewer' && semAtribuirCollaborator && filteredNotasSemAtribuir.length > 0 && (
                <CollaboratorMiniCard
                  collaborator={semAtribuirCollaborator}
                  isExpanded={expandedId === 'sem-atribuir'}
                  onClick={() => handleCardClick('sem-atribuir')}
                  forceCargoLabel="SEM RESPONSÁVEL"
                />
              )}
            </div>
          </div>

          {visibleCollaborators.map((c) => {
            const filtered = filteredNotasByAdmin.get(c.id) ?? []
            const admin = collaboratorById.get(c.id) ?? c
            const tracking = showInsideTracking && c.id === currentAdminId ? ordensAcompanhamento : undefined
            return (
              <CollaboratorAccordion
                key={c.id}
                collaborator={c}
                notas={filtered}
                isOpen={expandedId === c.id}
                viewMode="list"
                adminActions={mode === 'admin' && expandedId === c.id ? (
                  <CollaboratorAdminActions
                    admin={admin}
                    allDestinations={activeDestinationOptions}
                  />
                ) : undefined}
                trackingOrders={tracking}
                allowOperationalActions={!isReadOnlyViewer}
              />
            )
          })}

          {mode === 'viewer' && semAtribuirCollaborator && filteredNotasSemAtribuir.length > 0 && (
            <CollaboratorAccordion
              collaborator={semAtribuirCollaborator}
              notas={filteredNotasSemAtribuir}
              isOpen={expandedId === 'sem-atribuir'}
              viewMode="list"
              allowOperationalActions={!isReadOnlyViewer}
            />
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleCollaborators.map((c) => {
            const filtered = filteredNotasByAdmin.get(c.id) ?? []
            const admin = collaboratorById.get(c.id) ?? c
            const tracking = showInsideTracking && c.id === currentAdminId ? ordensAcompanhamento : undefined
            return (
              <CollaboratorFullCard
                key={c.id}
                collaborator={c}
                notas={filtered}
                adminActions={mode === 'admin' ? (
                  <CollaboratorAdminActions
                    admin={admin}
                    allDestinations={activeDestinationOptions}
                  />
                ) : undefined}
                trackingOrders={tracking}
                allowOperationalActions={!isReadOnlyViewer}
              />
            )
          })}

          {mode === 'viewer' && semAtribuirCollaborator && filteredNotasSemAtribuir.length > 0 && (
            <CollaboratorFullCard
              collaborator={semAtribuirCollaborator}
              notas={filteredNotasSemAtribuir}
              forceCargoLabel="SEM RESPONSÁVEL"
              allowOperationalActions={!isReadOnlyViewer}
            />
          )}
        </div>
      )}
    </div>
  )
}
