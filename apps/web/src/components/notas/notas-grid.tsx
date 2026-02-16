'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpDown, ExternalLink } from 'lucide-react'
import { type ColumnDef, type RowSelectionState, type SortingState, type VisibilityState } from '@tanstack/react-table'
import { DataGrid } from '@/components/data-grid/data-grid'
import { GridColumnVisibility } from '@/components/data-grid/grid-column-visibility'
import { GridFilters, type GridFilterOption } from '@/components/data-grid/grid-filters'
import { GridPagination } from '@/components/data-grid/grid-pagination'
import { GridSearch } from '@/components/data-grid/grid-search'
import { GridToolbar } from '@/components/data-grid/grid-toolbar'
import { AutoRefreshController } from '@/components/shared/auto-refresh-controller'
import { DrawerDetalhes } from '@/components/shared/drawer-detalhes'
import { SemaforoIdade } from '@/components/shared/semaforo-idade'
import { NotaStatusBadge } from '@/components/notas/nota-status-badge'
import { Button } from '@/components/ui/button'
import { getAgingDays } from '@/lib/collaborator/aging'
import { buildSortParam, updateSearchParams } from '@/lib/grid/query'
import type { GridSortState, NotaStatus } from '@/lib/types/database'

interface NotaGridRow {
  id: string
  numero_nota: string
  descricao: string
  status: NotaStatus
  prioridade: string | null
  centro: string | null
  data_criacao_sap: string | null
  created_at: string
  administrador_id: string | null
  responsavel_nome: string | null
}

interface NotasGridProps {
  rows: NotaGridRow[]
  total: number
  page: number
  pageSize: number
  sort: GridSortState
  q: string
  status: string
  responsavel: string
  unidade: string
  canViewGlobal: boolean
  responsavelOptions: GridFilterOption[]
  unidadeOptions: GridFilterOption[]
}

const PREFS_KEY = 'cockpit:notas:grid:prefs'

interface NotesGridPrefs {
  density: 'compact' | 'comfortable'
  hiddenColumns: string[]
}

const DEFAULT_PREFS: NotesGridPrefs = {
  density: 'comfortable',
  hiddenColumns: [],
}

function parsePrefs(): NotesGridPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as NotesGridPrefs
    return {
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      hiddenColumns: Array.isArray(parsed.hiddenColumns) ? parsed.hiddenColumns : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: NotesGridPrefs) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

function formatDate(value: string | null, fallbackIso: string): string {
  if (value) {
    const [year, month, day] = value.split('-')
    if (year && month && day) return `${day}/${month}/${year}`
  }

  const datePart = fallbackIso.split('T')[0]
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return fallbackIso
  return `${day}/${month}/${year}`
}

function SortableHeader({
  label,
  isSorted,
  onClick,
}: {
  label: string
  isSorted: false | 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${isSorted ? 'text-foreground' : 'opacity-50'}`} />
    </button>
  )
}

export function NotasGrid({
  rows,
  total,
  page,
  pageSize,
  sort,
  q,
  status,
  responsavel,
  unidade,
  canViewGlobal,
  responsavelOptions,
  unidadeOptions,
}: NotasGridProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [searchInput, setSearchInput] = useState(q)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable')
  const [selectedRow, setSelectedRow] = useState<NotaGridRow | null>(null)

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setSearchInput(q)
  }, [q])

  useEffect(() => {
    const prefs = parsePrefs()
    setDensity(prefs.density)
    const visibility: VisibilityState = {}
    for (const hiddenId of prefs.hiddenColumns) {
      visibility[hiddenId] = false
    }
    setColumnVisibility(visibility)
  }, [])

  useEffect(() => {
    const hiddenColumns = Object.entries(columnVisibility)
      .filter(([, visible]) => visible === false)
      .map(([id]) => id)
    savePrefs({ density, hiddenColumns })
  }, [density, columnVisibility])

  const sortingState = useMemo<SortingState>(() => [
    { id: sort.field, desc: sort.direction === 'desc' },
  ], [sort])

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
        const next: RowSelectionState = {}
        for (const row of rows) {
          next[row.id] = true
        }
        setRowSelection(next)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rows])

  const columns = useMemo<ColumnDef<NotaGridRow, unknown>[]>(() => [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={rows.length > 0 && rows.every((row) => rowSelection[row.id])}
          onChange={(event) => {
            if (event.target.checked) {
              const next: RowSelectionState = {}
              for (const row of rows) next[row.id] = true
              setRowSelection(next)
            } else {
              setRowSelection({})
            }
          }}
          aria-label="Selecionar todos"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          aria-label={`Selecionar nota ${row.original.numero_nota}`}
        />
      ),
      enableSorting: false,
    },
    {
      id: 'idade',
      accessorFn: (row) => getAgingDays({ data_criacao_sap: row.data_criacao_sap, created_at: row.created_at }),
      header: ({ column }) => (
        <SortableHeader
          label="Idade"
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        />
      ),
      cell: ({ getValue }) => <SemaforoIdade dias={Number(getValue() ?? 0)} />,
    },
    {
      id: 'numero_nota',
      accessorKey: 'numero_nota',
      header: ({ column }) => (
        <SortableHeader
          label="Nota"
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        />
      ),
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <p className="font-mono text-sm font-semibold">#{row.original.numero_nota}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.descricao}</p>
        </div>
      ),
    },
    {
      id: 'unidade',
      accessorKey: 'centro',
      header: ({ column }) => (
        <SortableHeader
          label="Unidade"
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        />
      ),
      cell: ({ row }) => row.original.centro ?? '—',
    },
    {
      id: 'responsavel',
      accessorKey: 'responsavel_nome',
      header: ({ column }) => (
        <SortableHeader
          label="Responsavel"
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        />
      ),
      cell: ({ row }) => row.original.responsavel_nome ?? 'Sem responsavel',
    },
    {
      id: 'data',
      accessorKey: 'data_criacao_sap',
      header: ({ column }) => (
        <SortableHeader
          label="Data"
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        />
      ),
      cell: ({ row }) => formatDate(row.original.data_criacao_sap, row.original.created_at),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: ({ column }) => (
        <SortableHeader
          label="Status"
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        />
      ),
      cell: ({ row }) => <NotaStatusBadge status={row.original.status} />,
    },
    {
      id: 'acoes',
      header: 'Acoes',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setSelectedRow(row.original)}>
            Detalhes
          </Button>
          <Button asChild type="button" variant="ghost" size="sm">
            <Link href={`/notas/${row.original.id}`}>
              Abrir
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      ),
    },
  ], [rows, rowSelection])

  const visibilityItems = [
    { id: 'idade', label: 'Idade' },
    { id: 'numero_nota', label: 'Nota' },
    { id: 'unidade', label: 'Unidade' },
    { id: 'responsavel', label: 'Responsavel' },
    { id: 'data', label: 'Data' },
    { id: 'status', label: 'Status' },
    { id: 'acoes', label: 'Acoes' },
  ].map((item) => ({
    ...item,
    visible: columnVisibility[item.id] !== false,
  }))

  const selectedCount = Object.keys(rowSelection).length

  return (
    <div className="space-y-4">
      <GridToolbar>
        <GridSearch
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por nota ou descricao..."
          inputRef={searchInputRef}
        />

        <GridFilters
          label="Status"
          value={status || 'todas'}
          onChange={(value) => replaceQuery({ status: value === 'todas' ? null : value, page: 1 })}
          options={[
            { value: 'todas', label: 'Todos os status' },
            { value: 'nova', label: 'Nova' },
            { value: 'em_andamento', label: 'Em andamento' },
            { value: 'encaminhada_fornecedor', label: 'Encaminhada' },
            { value: 'concluida', label: 'Concluida' },
            { value: 'cancelada', label: 'Cancelada' },
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
            { value: 'data:asc', label: 'Data (mais antiga)' },
            { value: 'data:desc', label: 'Data (mais recente)' },
            { value: 'idade:desc', label: 'Idade (maior primeiro)' },
            { value: 'numero_nota:asc', label: 'Nota (A-Z)' },
            { value: 'status:asc', label: 'Status (A-Z)' },
            { value: 'responsavel:asc', label: 'Responsavel (A-Z)' },
          ]}
          className="w-full xl:w-56"
        />

        <GridFilters
          label="Densidade"
          value={density}
          onChange={(value) => setDensity(value as 'compact' | 'comfortable')}
          options={[
            { value: 'comfortable', label: 'Confortavel' },
            { value: 'compact', label: 'Compacta' },
          ]}
          className="w-full xl:w-40"
        />

        <GridColumnVisibility
          columns={visibilityItems}
          onToggle={(id, nextVisible) => {
            setColumnVisibility((prev: VisibilityState) => ({
              ...prev,
              [id]: nextVisible,
            }))
          }}
        />
      </GridToolbar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <AutoRefreshController onRefresh={() => router.refresh()} defaultIntervalSec={30} />

        <span className="hidden lg:inline text-[11px] text-muted-foreground/60">
          / buscar &middot; r atualizar &middot; Shift+A selecionar tudo
        </span>

        {selectedCount > 0 && (
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
            {selectedCount} selecionada(s)
            <Button type="button" variant="ghost" size="sm" className="ml-2 h-6 px-2" onClick={() => setRowSelection({})}>
              Limpar
            </Button>
          </div>
        )}
      </div>

      <DataGrid
        data={rows}
        columns={columns}
        sorting={sortingState}
        onSortingChange={(updater) => {
          const next = typeof updater === 'function' ? updater(sortingState) : updater
          const first = next[0]
          if (!first) return
          replaceQuery({
            sort: `${first.id}:${first.desc ? 'desc' : 'asc'}`,
            page: 1,
          })
        }}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={(row) => row.id}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        emptyMessage="Nenhuma nota encontrada com os filtros atuais."
        density={density}
      />

      <GridPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(nextPage) => replaceQuery({ page: nextPage })}
        onPageSizeChange={(nextSize) => replaceQuery({ pageSize: nextSize, page: 1 })}
      />

      <DrawerDetalhes
        open={Boolean(selectedRow)}
        onOpenChange={(open) => {
          if (!open) setSelectedRow(null)
        }}
        title={selectedRow ? `Nota #${selectedRow.numero_nota}` : 'Detalhes da nota'}
        subtitle={selectedRow?.descricao ?? undefined}
      >
        {selectedRow ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <NotaStatusBadge status={selectedRow.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Responsavel</span>
              <span>{selectedRow.responsavel_nome ?? 'Sem responsavel'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Unidade</span>
              <span>{selectedRow.centro ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Data</span>
              <span>{formatDate(selectedRow.data_criacao_sap, selectedRow.created_at)}</span>
            </div>

            <div className="pt-2">
              <Button asChild className="w-full">
                <Link href={`/notas/${selectedRow.id}`}>Abrir detalhe completo</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </DrawerDetalhes>
    </div>
  )
}
