'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, LayoutGrid, Rows3, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildAgingCounts, matchNotesKpi } from '@/lib/collaborator/metrics'
import { CollaboratorMiniCard } from './collaborator-mini-card'
import { CollaboratorAccordion } from './collaborator-accordion'
import { CollaboratorAdminActions } from './collaborator-admin-actions'
import { CollaboratorFullCard } from './collaborator-full-card'
import { TrackingOrdersBlock } from './tracking-orders-block'
import type {
  CollaboratorData,
  NotesViewMode,
  TrackingPositionMode,
} from '@/lib/types/collaborator'
import type { NotesKpiFilter, NotaPanelData, OrdemAcompanhamento } from '@/lib/types/database'
import { updateSearchParams } from '@/lib/grid/query'

interface CollaboratorPanelProps {
  collaborators: CollaboratorData[]
  notas: NotaPanelData[]
  mode: 'viewer' | 'admin'
  notasSemAtribuir?: NotaPanelData[]
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
  activeNotesKpi?: NotesKpiFilter | null
}

const VIEW_MODE_STORAGE_KEY = 'cockpit:panel:view-mode'
const TRACKING_POSITION_STORAGE_KEY = 'cockpit:panel:tracking-position'

export function CollaboratorPanel({
  collaborators,
  notas,
  mode,
  notasSemAtribuir,
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
  activeNotesKpi = null,
}: CollaboratorPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState(initialStatus || 'abertas')
  const [responsavelFilter, setResponsavelFilter] = useState(initialResponsavel || 'todos')
  const [unidadeFilter, setUnidadeFilter] = useState(initialUnidade || 'todas')
  const [viewMode, setViewMode] = useState<NotesViewMode>('list')
  const [trackingPosition, setTrackingPosition] = useState<TrackingPositionMode>('top')

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

  function replaceQuery(updates: Record<string, string | number | null | undefined>) {
    if (!syncWithUrl) return
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), updates)
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }

  useEffect(() => {
    if (!syncWithUrl) return
    const timer = setTimeout(() => {
      const normalized = search.trim()
      if (normalized === initialSearch) return
      replaceQuery({ q: normalized || null })
    }, 300)

    return () => clearTimeout(timer)
  }, [search, initialSearch, syncWithUrl])

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
    setStatusFilter(value)
    if (syncWithUrl) {
      replaceQuery({ status: value === 'abertas' ? null : value })
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

  const notasByAdmin = useMemo(() => {
    const map = new Map<string, NotaPanelData[]>()
    for (const nota of notas) {
      if (!nota.administrador_id) continue
      const list = map.get(nota.administrador_id)
      if (list) {
        list.push(nota)
      } else {
        map.set(nota.administrador_id, [nota])
      }
    }
    return map
  }, [notas])

  const destinationsByAdmin = useMemo(() => {
    const map = new Map<string, Array<{ id: string; nome: string }>>()
    for (const admin of collaborators) {
      const dests = collaborators
        .filter((item) => item.id !== admin.id && item.ativo && !item.em_ferias)
        .map((item) => ({ id: item.id, nome: item.nome }))
      map.set(admin.id, dests)
    }
    return map
  }, [collaborators])

  function filterNotas(list: NotaPanelData[]) {
    let filtered = list

    if (statusFilter === 'abertas') {
      filtered = filtered.filter((n) => n.status !== 'concluida' && n.status !== 'cancelada')
    } else if (statusFilter !== 'todas') {
      filtered = filtered.filter((n) => n.status === statusFilter)
    }

    if (unidadeFilter && unidadeFilter !== 'todas') {
      filtered = filtered.filter((n) => (n.centro ?? '') === unidadeFilter)
    }

    if (activeNotesKpi) {
      filtered = filtered.filter((n) => matchNotesKpi(n, activeNotesKpi))
    }

    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (n) =>
          n.numero_nota.toLowerCase().includes(q)
          || n.descricao.toLowerCase().includes(q)
      )
    }

    return filtered
  }

  const filteredNotasSemAtribuir = useMemo(
    () => filterNotas(notasSemAtribuir ?? []),
    [notasSemAtribuir, statusFilter, unidadeFilter, activeNotesKpi, search]
  )

  const visibleCollaborators = useMemo(() => {
    let list = collaborators

    if (showResponsavelFilter && responsavelFilter && responsavelFilter !== 'todos') {
      if (responsavelFilter === 'sem_atribuir') {
        list = []
      } else {
        list = list.filter((c) => c.id === responsavelFilter)
      }
    }

    const hasActiveFilter = Boolean(
      search
      || (statusFilter && statusFilter !== 'abertas')
      || (unidadeFilter && unidadeFilter !== 'todas')
      || activeNotesKpi
      || (showResponsavelFilter && responsavelFilter && responsavelFilter !== 'todos')
    )

    if (hasActiveFilter) {
      list = list.filter((collaborator) => filterNotas(notasByAdmin.get(collaborator.id) ?? []).length > 0)
    }

    return list
  }, [
    collaborators,
    responsavelFilter,
    showResponsavelFilter,
    search,
    statusFilter,
    unidadeFilter,
    activeNotesKpi,
    notasByAdmin,
  ])

  function handleCardClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const isAdminViewer = mode === 'viewer' && currentAdminRole === 'admin'
  const isGestorViewer = mode === 'viewer' && currentAdminRole === 'gestor'
  const shouldShowTrackingControls = isAdminViewer && ordensAcompanhamento.length > 0
  const showTopTracking = ordensAcompanhamento.length > 0
    && (isGestorViewer || trackingPosition === 'top' || trackingPosition === 'both')
  const showInsideTracking = isAdminViewer && (trackingPosition === 'inside' || trackingPosition === 'both')

  const semAtribuirCollaborator: CollaboratorData | null = useMemo(() => {
    if (!filteredNotasSemAtribuir || filteredNotasSemAtribuir.length === 0) return null
    const aging = buildAgingCounts(filteredNotasSemAtribuir)
    return {
      id: 'sem-atribuir',
      nome: 'Sem Atribuir',
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
  }, [filteredNotasSemAtribuir])

  const activeFilterChips = [
    search ? { key: 'q', label: `Busca: ${search}` } : null,
    statusFilter && statusFilter !== 'abertas' ? { key: 'status', label: `Status: ${statusFilter}` } : null,
    showResponsavelFilter && responsavelFilter && responsavelFilter !== 'todos'
      ? { key: 'responsavel', label: 'Responsavel filtrado' }
      : null,
    showUnidadeFilter && unidadeFilter && unidadeFilter !== 'todas'
      ? { key: 'unidade', label: `Unidade: ${unidadeFilter}` }
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
      {showTopTracking && (
        <TrackingOrdersBlock
          orders={ordensAcompanhamento}
          title={currentAdminRole === 'gestor' ? 'Ordens em acompanhamento (visao gestor)' : 'Minhas ordens em acompanhamento'}
        />
      )}

      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por numero ou descricao..."
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
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="nova">Novas</SelectItem>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="encaminhada_fornecedor">Encaminhadas</SelectItem>
            <SelectItem value="concluida">Concluidas</SelectItem>
            <SelectItem value="cancelada">Canceladas</SelectItem>
          </SelectContent>
        </Select>

        {showResponsavelFilter && responsavelOptions.length > 0 && (
          <Select value={responsavelFilter} onValueChange={handleResponsavelChange}>
            <SelectTrigger className="w-full xl:w-56">
              <SelectValue placeholder="Responsavel" />
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

        <Select value={viewMode} onValueChange={handleViewModeChange}>
          <SelectTrigger className="w-full xl:w-48">
            <SelectValue placeholder="Visualizacao" />
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
                <Card
                  onClick={() => handleCardClick('sem-atribuir')}
                  className={`cursor-pointer border-orange-200 p-3 transition-all hover:shadow-md ${
                    expandedId === 'sem-atribuir' ? 'bg-orange-50 ring-2 ring-orange-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                      <AlertCircle className="h-5 w-5 text-orange-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-orange-700">Sem Atribuir</p>
                      <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                        {filteredNotasSemAtribuir.length} nota{filteredNotasSemAtribuir.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>

          {visibleCollaborators.map((c) => {
            const filtered = filterNotas(notasByAdmin.get(c.id) ?? [])
            const tracking = showInsideTracking && c.id === currentAdminId ? ordensAcompanhamento : undefined
            return (
              <CollaboratorAccordion
                key={c.id}
                collaborator={c}
                notas={filtered}
                isOpen={expandedId === c.id}
                viewMode="list"
                adminActions={mode === 'admin' ? (
                  <CollaboratorAdminActions
                    admin={c}
                    destinations={destinationsByAdmin.get(c.id) ?? []}
                  />
                ) : undefined}
                trackingOrders={tracking}
              />
            )
          })}

          {mode === 'viewer' && semAtribuirCollaborator && filteredNotasSemAtribuir.length > 0 && (
            <CollaboratorAccordion
              collaborator={semAtribuirCollaborator}
              notas={filteredNotasSemAtribuir}
              isOpen={expandedId === 'sem-atribuir'}
              viewMode="list"
            />
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleCollaborators.map((c) => {
            const filtered = filterNotas(notasByAdmin.get(c.id) ?? [])
            const tracking = showInsideTracking && c.id === currentAdminId ? ordensAcompanhamento : undefined
            return (
              <CollaboratorFullCard
                key={c.id}
                collaborator={c}
                notas={filtered}
                adminActions={mode === 'admin' ? (
                  <CollaboratorAdminActions
                    admin={c}
                    destinations={destinationsByAdmin.get(c.id) ?? []}
                  />
                ) : undefined}
                trackingOrders={tracking}
              />
            )
          })}

          {mode === 'viewer' && semAtribuirCollaborator && filteredNotasSemAtribuir.length > 0 && (
            <CollaboratorFullCard
              collaborator={semAtribuirCollaborator}
              notas={filteredNotasSemAtribuir}
            />
          )}
        </div>
      )}
    </div>
  )
}
