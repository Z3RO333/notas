'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Rows3 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import { OrdersOwnerMiniCard } from '@/components/orders/orders-owner-mini-card'
import { OrdersOwnerAccordion } from '@/components/orders/orders-owner-accordion'
import { OrdersOwnerFullCard } from '@/components/orders/orders-owner-full-card'
import { AutoRefreshController } from '@/components/shared/auto-refresh-controller'
import { GridFilters, type GridFilterOption } from '@/components/data-grid/grid-filters'
import { GridPagination } from '@/components/data-grid/grid-pagination'
import { GridSearch } from '@/components/data-grid/grid-search'
import { GridToolbar } from '@/components/data-grid/grid-toolbar'
import { buildSortParam, updateSearchParams } from '@/lib/grid/query'
import type {
  GridSortState,
  OrderOwnerGroup,
  OrderOwnerMode,
  OrderReassignTarget,
  OrdersKpiFilter,
  PanelViewMode,
  OrdemNotaAcompanhamento,
  OrdemStatusAcomp,
} from '@/lib/types/database'

interface OrdersOwnerPanelProps {
  rows: OrdemNotaAcompanhamento[]
  total: number
  page: number
  pageSize: number
  sort: GridSortState
  q: string
  status: string
  responsavel: string
  unidade: string
  activeKpi: OrdersKpiFilter | null
  canViewGlobal: boolean
  canReassign?: boolean
  reassignTargets?: OrderReassignTarget[]
  responsavelOptions: GridFilterOption[]
  unidadeOptions: GridFilterOption[]
  avatarById: Record<string, string | null>
}

type OrderStatusFilter = OrdemStatusAcomp | 'todas'

const OWNER_MODE_STORAGE_KEY = 'cockpit:ordens:owner-mode'
const VIEW_MODE_STORAGE_KEY = 'cockpit:ordens:view-mode'

const OWNER_MODE_OPTIONS: Array<{ value: OrderOwnerMode; label: string }> = [
  { value: 'atual', label: 'Responsavel atual' },
  { value: 'origem', label: 'Responsavel de origem' },
]

const VIEW_MODE_OPTIONS: Array<{ value: PanelViewMode; label: string; icon: typeof Rows3 }> = [
  { value: 'list', label: 'Lista vertical', icon: Rows3 },
  { value: 'cards', label: 'Cards completos', icon: LayoutGrid },
]

function resolveOwner(row: OrdemNotaAcompanhamento, mode: OrderOwnerMode): { id: string; nome: string } {
  if (mode === 'origem') {
    return {
      id: row.administrador_id ?? '__sem_origem__',
      nome: row.administrador_nome ?? 'Sem responsavel de origem',
    }
  }

  return {
    id: row.responsavel_atual_id ?? '__sem_atual__',
    nome: row.responsavel_atual_nome ?? 'Sem responsavel atual',
  }
}

function buildGroups(
  rows: OrdemNotaAcompanhamento[],
  mode: OrderOwnerMode,
  avatarById: Record<string, string | null>
): OrderOwnerGroup[] {
  const map = new Map<string, OrderOwnerGroup>()

  for (const row of rows) {
    const owner = resolveOwner(row, mode)
    const current = map.get(owner.id) ?? {
      id: owner.id,
      nome: owner.nome,
      avatar_url: avatarById[owner.id] ?? null,
      rows: [],
      recentes: 0,
      atencao: 0,
      atrasadas: 0,
      total: 0,
    }

    current.rows.push(row)
    current.total += 1
    if (row.semaforo_atraso === 'verde') current.recentes += 1
    if (row.semaforo_atraso === 'amarelo') current.atencao += 1
    if (row.semaforo_atraso === 'vermelho') current.atrasadas += 1

    map.set(owner.id, current)
  }

  return [...map.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

export function OrdersOwnerPanel({
  rows,
  total,
  page,
  pageSize,
  sort,
  q,
  status,
  responsavel,
  unidade,
  activeKpi,
  canViewGlobal,
  canReassign = false,
  reassignTargets = [],
  responsavelOptions,
  unidadeOptions,
  avatarById,
}: OrdersOwnerPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [searchInput, setSearchInput] = useState(q)
  const [ownerMode, setOwnerMode] = useState<OrderOwnerMode>('atual')
  const [viewMode, setViewMode] = useState<PanelViewMode>('list')
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null)
  const [selectedNotaIds, setSelectedNotaIds] = useState<string[]>([])

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setSearchInput(q)
  }, [q])

  useEffect(() => {
    const persistedOwnerMode = window.localStorage.getItem(OWNER_MODE_STORAGE_KEY)
    if (persistedOwnerMode === 'atual' || persistedOwnerMode === 'origem') {
      setOwnerMode(persistedOwnerMode)
    }

    const persistedViewMode = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (persistedViewMode === 'list' || persistedViewMode === 'cards') {
      setViewMode(persistedViewMode)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(OWNER_MODE_STORAGE_KEY, ownerMode)
  }, [ownerMode])

  useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode)
  }, [viewMode])

  function replaceQuery(updates: Record<string, string | number | null | undefined>) {
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), updates)
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = searchInput.trim()
      if (normalized === q) return
      replaceQuery({ q: normalized || null, page: 1 })
    }, 300)

    return () => clearTimeout(timer)
  }, [searchInput, q])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        router.refresh()
        return
      }

      if (event.key.toLowerCase() === 'a' && event.shiftKey) {
        event.preventDefault()
        const visibleIds = Array.from(new Set(rows.map((row) => row.nota_id)))
        setSelectedNotaIds(visibleIds)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rows])

  const groups = useMemo(() => buildGroups(rows, ownerMode, avatarById), [rows, ownerMode, avatarById])

  useEffect(() => {
    setExpandedOwnerId((prev) => {
      if (groups.length === 0) return null
      if (prev && groups.some((group) => group.id === prev)) return prev
      return groups[0].id
    })
  }, [groups])

  const visibleNotaIds = useMemo(
    () => Array.from(new Set(rows.map((row) => row.nota_id))),
    [rows]
  )

  useEffect(() => {
    setSelectedNotaIds((prev) => prev.filter((id) => visibleNotaIds.includes(id)))
  }, [visibleNotaIds])

  const selectedNotaIdsSet = useMemo(() => new Set(selectedNotaIds), [selectedNotaIds])
  const allVisibleSelected = visibleNotaIds.length > 0
    && visibleNotaIds.every((id) => selectedNotaIdsSet.has(id))

  const canBulkReassign = canReassign && reassignTargets.length > 0

  function handleCardClick(ownerId: string) {
    setExpandedOwnerId((prev) => (prev === ownerId ? null : ownerId))
  }

  function handleToggleRowSelection(notaId: string) {
    setSelectedNotaIds((prev) => (
      prev.includes(notaId)
        ? prev.filter((id) => id !== notaId)
        : [...prev, notaId]
    ))
  }

  function handleToggleSelectAll() {
    setSelectedNotaIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleNotaIds.includes(id))
      }

      const merged = new Set([...prev, ...visibleNotaIds])
      return Array.from(merged)
    })
  }

  const activeFilters = [
    q ? { key: 'q', label: `Busca: ${q}` } : null,
    status ? { key: 'status', label: `Status: ${status}` } : null,
    responsavel ? { key: 'responsavel', label: 'Responsavel filtrado' } : null,
    unidade ? { key: 'unidade', label: `Unidade: ${unidade}` } : null,
    activeKpi ? { key: 'kpi', label: `KPI: ${activeKpi}` } : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>

  return (
    <div className="space-y-4">
      <GridToolbar>
        <GridSearch
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por nota, ordem ou descricao..."
          inputRef={searchInputRef}
        />

        <GridFilters
          label="Status"
          value={(status as OrderStatusFilter) || 'todas'}
          onChange={(value) => replaceQuery({ status: value === 'todas' ? null : value, page: 1 })}
          options={[
            { value: 'todas', label: 'Todos os status' },
            { value: 'aberta', label: 'Aberta' },
            { value: 'em_tratativa', label: 'Em tratativa' },
            { value: 'concluida', label: 'Concluida' },
            { value: 'cancelada', label: 'Cancelada' },
            { value: 'desconhecido', label: 'Desconhecido' },
          ]}
        />

        {canViewGlobal && (
          <GridFilters
            label="Responsavel"
            value={responsavel || 'todos'}
            onChange={(value) => replaceQuery({ responsavel: value === 'todos' ? null : value, page: 1 })}
            options={responsavelOptions}
          />
        )}

        <GridFilters
          label="Unidade"
          value={unidade || 'todas'}
          onChange={(value) => replaceQuery({ unidade: value === 'todas' ? null : value, page: 1 })}
          options={unidadeOptions}
        />

        <GridFilters
          label="Ordenacao"
          value={buildSortParam(sort)}
          onChange={(value) => replaceQuery({ sort: value, page: 1 })}
          options={[
            { value: 'data:desc', label: 'Data (mais recente)' },
            { value: 'data:asc', label: 'Data (mais antiga)' },
            { value: 'idade:desc', label: 'Idade (maior primeiro)' },
            { value: 'ordem:asc', label: 'Ordem (A-Z)' },
            { value: 'status:asc', label: 'Status (A-Z)' },
            { value: 'responsavel:asc', label: 'Responsavel (A-Z)' },
            { value: 'unidade:asc', label: 'Unidade (A-Z)' },
          ]}
          className="w-full xl:w-56"
        />

        <Select value={ownerMode} onValueChange={(value) => setOwnerMode(value as OrderOwnerMode)}>
          <SelectTrigger className="w-full xl:w-56">
            <SelectValue placeholder="Agrupar por" />
          </SelectTrigger>
          <SelectContent>
            {OWNER_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={viewMode} onValueChange={(value) => setViewMode(value as PanelViewMode)}>
          <SelectTrigger className="w-full xl:w-48">
            <SelectValue placeholder="Visualizacao" />
          </SelectTrigger>
          <SelectContent>
            {VIEW_MODE_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </GridToolbar>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50"
              onClick={() => replaceQuery({ [filter.key]: null, page: 1 })}
            >
              {filter.label} ×
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <AutoRefreshController onRefresh={() => router.refresh()} defaultIntervalSec={30} />

        {canBulkReassign && rows.length > 0 && (
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={allVisibleSelected}
              onChange={handleToggleSelectAll}
            />
            Selecionar visiveis
          </label>
        )}
      </div>

      {canBulkReassign && selectedNotaIds.length > 0 && (
        <OrdersBulkReassignBar
          selectedNotaIds={selectedNotaIds}
          admins={reassignTargets}
          onClearSelection={() => setSelectedNotaIds([])}
          onReassigned={() => setSelectedNotaIds([])}
        />
      )}

      {groups.length > 0 ? (
        viewMode === 'list' ? (
          <>
            <div className="sticky top-14 z-40 bg-background/95 pb-3 pt-1 backdrop-blur">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {groups.map((group) => (
                  <OrdersOwnerMiniCard
                    key={group.id}
                    group={group}
                    isExpanded={expandedOwnerId === group.id}
                    onClick={() => handleCardClick(group.id)}
                  />
                ))}
              </div>
            </div>

            {groups.map((group) => (
              <OrdersOwnerAccordion
                key={group.id}
                group={group}
                isOpen={expandedOwnerId === group.id}
                canReassign={canBulkReassign}
                selectedNotaIds={selectedNotaIdsSet}
                onToggleRowSelection={handleToggleRowSelection}
              />
            ))}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <OrdersOwnerFullCard
                key={group.id}
                group={group}
                canReassign={canBulkReassign}
                selectedNotaIds={selectedNotaIdsSet}
                onToggleRowSelection={handleToggleRowSelection}
              />
            ))}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma ordem encontrada com os filtros selecionados.
        </div>
      )}

      <GridPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(nextPage) => replaceQuery({ page: nextPage })}
        onPageSizeChange={(nextSize) => replaceQuery({ pageSize: nextSize, page: 1 })}
      />
    </div>
  )
}
