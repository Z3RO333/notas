'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Download,
  LayoutGrid,
  Loader2,
  RefreshCcw,
  Rows3,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import { OrdersDetailDrawer } from '@/components/orders/orders-detail-drawer'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersOwnerFullCard } from '@/components/orders/orders-owner-full-card'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getOrdersCriticalityLevel,
  getOrderStatusLabel,
  getSemaforoLabel,
  workspaceKpisToOrdemNotaKpis,
} from '@/lib/orders/metrics'
import type {
  OrderOwnerGroup,
  OrdersOwnerSummary,
  OrdersPeriodModeOperational,
  PanelViewMode,
  OrdersWorkspaceCursor,
  OrdersWorkspaceFilters,
  OrdersWorkspaceKpis,
  OrdersWorkspaceResponse,
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
  UserRole,
} from '@/lib/types/database'

interface OrdersWorkspaceProps {
  initialFilters: OrdersWorkspaceFilters
  initialUser: {
    role: UserRole
    adminId: string
    canViewGlobal: boolean
    canAccessPmpl: boolean
    userEmail: string
  }
}

const MONTH_LABELS = [
  { value: 1, label: 'Janeiro' },
  { value: 2, label: 'Fevereiro' },
  { value: 3, label: 'Março' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Maio' },
  { value: 6, label: 'Junho' },
  { value: 7, label: 'Julho' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Setembro' },
  { value: 10, label: 'Outubro' },
  { value: 11, label: 'Novembro' },
  { value: 12, label: 'Dezembro' },
]

const PERIOD_MODE_LABELS: Array<{ value: OrdersPeriodModeOperational; label: string }> = [
  { value: 'all', label: 'Todo histórico' },
  { value: 'year', label: 'Ano' },
  { value: 'year_month', label: 'Ano + mês' },
  { value: 'month', label: 'Mês (todos os anos)' },
  { value: 'range', label: 'Intervalo específico' },
]

const STATUS_OPTIONS = [
  { value: 'todas', label: 'Todos os status' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_tratativa', label: 'Em tratativa' },
  { value: 'em_avaliacao', label: 'Em avaliação' },
  { value: 'avaliadas', label: 'Avaliadas' },
  { value: 'nao_realizada', label: 'Não realizada' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'desconhecido', label: 'Desconhecido' },
]

const PRIORIDADE_OPTIONS = [
  { value: 'todas', label: 'Todas prioridades' },
  { value: 'verde', label: 'Recente (0-2d)' },
  { value: 'amarelo', label: 'Atenção (3-6d)' },
  { value: 'vermelho', label: 'Atrasada (7+d)' },
]

const OWNER_CARDS_VIEW_MODE_STORAGE_KEY = 'cockpit:ordens:owner-cards:view-mode'
const FIXED_OWNER_CARD_ORDER = {
  'Brenda': 0,
  'Adriano': 1,
} as const
const GUSTAVO_OWNER_NAME = 'gustavo andrade'

function normalizePersonName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function isGustavoOwner(ownerName: string): boolean {
  return normalizePersonName(ownerName) === GUSTAVO_OWNER_NAME
}

const CARGO_BADGE: Record<string, { color: string }> = {
  'CD TURISMO':      { color: 'bg-teal-100 text-teal-800' },
  'CD MANAUS':       { color: 'bg-blue-100 text-blue-800' },
  'REFRIGERAÇÃO':    { color: 'bg-cyan-100 text-cyan-800' },
  'GERAL':           { color: 'bg-gray-100 text-gray-800' },
  'SEM RESPONSÁVEL': { color: 'bg-orange-100 text-orange-800' },
}

function resolveOwnerCargo(owner: OrdersOwnerSummary): string {
  if (owner.administrador_id === null) return 'SEM RESPONSÁVEL'

  const normalizedName = normalizePersonName(owner.nome)
  if (normalizedName.includes('adriano')) return 'CD TURISMO'
  if (normalizedName.includes('brenda')) return 'CD MANAUS'
  if (normalizedName.includes('suelem')) return 'REFRIGERAÇÃO'
  if (normalizedName.includes('paula')) return 'GERAL'
  return 'GERAL'
}

function sanitizeText(value: string): string {
  return value.trim()
}

function formatIsoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR')
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function exportOrdersToXlsx(rows: OrdemNotaAcompanhamento[]) {
  const data = rows.map((row) => ({
    'Ordem': row.ordem_codigo,
    'Nota': row.numero_nota,
    'Status': getOrderStatusLabel(row.status_ordem),
    'Status RAW': row.status_ordem_raw ?? '',
    'Centro': row.centro ?? '',
    'Unidade': row.unidade ?? '',
    'Responsável': row.administrador_nome ?? 'Sem responsável',
    'Semáforo': getSemaforoLabel(row.semaforo_atraso),
    'Dias em aberto': row.dias_em_aberto,
    'Detectada em': formatIsoDate(row.ordem_detectada_em),
    'Descrição': row.descricao ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ordens')
  const filename = `ordens_${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(wb, filename)
}


function toIsoStart(dateInput: string | null): string | null {
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toIsoEndExclusive(dateInput: string | null): string | null {
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function makeYearOptions(): number[] {
  const current = new Date().getUTCFullYear()
  return Array.from({ length: 12 }, (_, idx) => current - idx)
}

function normalizeNotaId(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function getRowNotaId(row: OrdemNotaAcompanhamento): string | null {
  return normalizeNotaId(row.nota_id)
}

function buildWorkspaceParams(filters: OrdersWorkspaceFilters, cursor: OrdersWorkspaceCursor | null, limit: number): URLSearchParams {
  const params = new URLSearchParams()
  params.set('periodMode', filters.periodMode)

  if (filters.year) params.set('year', String(filters.year))
  if (filters.month) params.set('month', String(filters.month))
  if (filters.startDate) params.set('startIso', toIsoStart(filters.startDate) ?? '')
  if (filters.endDate) params.set('endExclusiveIso', toIsoEndExclusive(filters.endDate) ?? '')

  if (filters.q) params.set('q', filters.q)
  if (filters.status && filters.status !== 'todas') params.set('status', filters.status)
  if (filters.responsavel && filters.responsavel !== 'todos') params.set('responsavel', filters.responsavel)
  if (filters.unidade) params.set('unidade', filters.unidade)
  if (filters.prioridade && filters.prioridade !== 'todas') params.set('prioridade', filters.prioridade)
  if (filters.tipoOrdem) params.set('tipoOrdem', filters.tipoOrdem)

  if (cursor) {
    params.set('cursorDetectada', cursor.ordem_detectada_em)
    params.set('cursorOrdemId', cursor.ordem_id)
  }

  params.set('limit', String(limit))
  return params
}

function syncFiltersToUrl(filters: OrdersWorkspaceFilters) {
  const params = new URLSearchParams(window.location.search)
  const setOrDelete = (key: string, value: string | null) => {
    if (!value) {
      params.delete(key)
      return
    }
    params.set(key, value)
  }

  setOrDelete('periodMode', filters.periodMode !== 'all' ? filters.periodMode : null)
  setOrDelete('year', filters.year ? String(filters.year) : null)
  setOrDelete('month', filters.month ? String(filters.month) : null)
  setOrDelete('startDate', filters.startDate)
  setOrDelete('endDate', filters.endDate)
  setOrDelete('q', filters.q || null)
  setOrDelete('status', filters.status && filters.status !== 'todas' ? filters.status : null)
  setOrDelete('responsavel', filters.responsavel && filters.responsavel !== 'todos' ? filters.responsavel : null)
  setOrDelete('unidade', filters.unidade || null)
  setOrDelete('prioridade', filters.prioridade && filters.prioridade !== 'todas' ? filters.prioridade : null)
  setOrDelete('tipoOrdem', filters.tipoOrdem || null)

  const query = params.toString()
  window.history.replaceState({}, '', query ? `?${query}` : window.location.pathname)
}

function mergeRows(prev: OrdemNotaAcompanhamento[], incoming: OrdemNotaAcompanhamento[]): OrdemNotaAcompanhamento[] {
  const byId = new Map(prev.map((row) => [row.ordem_id, row]))
  for (const row of incoming) {
    byId.set(row.ordem_id, row)
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = Date.parse(a.ordem_detectada_em)
    const bTime = Date.parse(b.ordem_detectada_em)
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime
    return b.ordem_id.localeCompare(a.ordem_id)
  })
}

export function OrdersWorkspace({ initialFilters, initialUser }: OrdersWorkspaceProps) {
  const years = useMemo(() => makeYearOptions(), [])
  const [filters, setFilters] = useState<OrdersWorkspaceFilters>(initialFilters)
  const [searchInput, setSearchInput] = useState(initialFilters.q)
  const [rows, setRows] = useState<OrdemNotaAcompanhamento[]>([])
  const [kpis, setKpis] = useState<OrdersWorkspaceKpis>({
    total: 0,
    abertas: 0,
    em_tratativa: 0,
    em_avaliacao: 0,
    concluidas: 0,
    canceladas: 0,
    avaliadas: 0,
    atrasadas: 0,
    sem_responsavel: 0,
  })
  const [ownerSummary, setOwnerSummary] = useState<OrdersOwnerSummary[]>([])
  const [reassignTargets, setReassignTargets] = useState<OrderReassignTarget[]>([])
  const [nextCursor, setNextCursor] = useState<OrdersWorkspaceCursor | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedNotaIds, setSelectedNotaIds] = useState<string[]>([])
  const [detailRow, setDetailRow] = useState<OrdemNotaAcompanhamento | null>(null)
  const [currentUser, setCurrentUser] = useState(initialUser)
  const [ownerCardsViewMode, setOwnerCardsViewMode] = useState<PanelViewMode>('list')

  const fetchAbortRef = useRef<AbortController | null>(null)
  const parentRef = useRef<HTMLDivElement | null>(null)
  const canReassign = currentUser.canViewGlobal
  const batchSize = 100

  const ownerById = useMemo(() => {
    const map = new Map<string, string>()
    for (const target of reassignTargets) {
      map.set(target.id, target.nome)
    }
    return map
  }, [reassignTargets])

  const selectedNotaIdsSet = useMemo(() => new Set(selectedNotaIds), [selectedNotaIds])

  const ownerGroups = useMemo((): OrderOwnerGroup[] => {
    if (ownerCardsViewMode !== 'cards') return []

    // Agrupar rows carregados por responsável (para a lista de itens)
    const rowsByOwner = new Map<string, OrdemNotaAcompanhamento[]>()
    for (const row of rows) {
      const id = row.responsavel_atual_id ?? '__sem_atual__'
      const bucket = rowsByOwner.get(id) ?? []
      bucket.push(row)
      rowsByOwner.set(id, bucket)
    }

    // Usar ownerSummary para os totais corretos (dados completos da API)
    return ownerSummary
      .filter((s) => {
        if (s.total <= 0) return false
        // Gustavo deve aparecer na aba PMPL; em PMOS mantém regra legada de ocultar.
        if (filters.tipoOrdem === 'PMPL') return true
        return !isGustavoOwner(s.nome)
      })
      .map((s) => ({
        id: s.administrador_id ?? '__sem_atual__',
        nome: s.nome,
        avatar_url: s.avatar_url,
        rows: rowsByOwner.get(s.administrador_id ?? '__sem_atual__') ?? [],
        recentes: s.recentes,
        atencao: s.atencao,
        atrasadas: s.atrasadas,
        abertas: s.abertas,
        total: s.total,
      }))
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [rows, ownerCardsViewMode, ownerSummary, filters.tipoOrdem])

  useEffect(() => {
    const timer = setTimeout(() => {
      const clean = sanitizeText(searchInput)
      setFilters((prev) => (prev.q === clean ? prev : { ...prev, q: clean }))
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const persisted = window.localStorage.getItem(OWNER_CARDS_VIEW_MODE_STORAGE_KEY)
    if (persisted === 'list' || persisted === 'cards') {
      setOwnerCardsViewMode(persisted)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    syncFiltersToUrl(filters)
  }, [filters])

  useEffect(() => {
    if (currentUser.canAccessPmpl) return
    if (filters.tipoOrdem !== 'PMPL') return
    setFilters((prev) => ({ ...prev, tipoOrdem: 'PMOS' }))
  }, [currentUser.canAccessPmpl, filters.tipoOrdem])

  const fetchWorkspace = useCallback(async (reset: boolean) => {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    if (reset) {
      setLoadingInitial(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }

    try {
      const params = buildWorkspaceParams(filters, reset ? null : nextCursor, batchSize)
      const response = await fetch(`/api/ordens/workspace?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar ordens')
      }

      const payload = (await response.json()) as OrdersWorkspaceResponse
      setCurrentUser((prev) => ({ ...payload.currentUser, userEmail: prev.userEmail }))
      setKpis(payload.kpis)
      setOwnerSummary(payload.ownerSummary)
      setReassignTargets(payload.reassignTargets)
      setNextCursor(payload.nextCursor)

      if (reset) {
        setRows(payload.rows)
        setSelectedNotaIds([])
      } else {
        setRows((prev) => mergeRows(prev, payload.rows))
      }
    } catch (fetchError) {
      if ((fetchError as Error).name === 'AbortError') return
      setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar ordens')
      if (reset) {
        setRows([])
        setNextCursor(null)
      }
    } finally {
      if (reset) setLoadingInitial(false)
      setLoadingMore(false)
    }
  }, [filters, nextCursor])

  useEffect(() => {
    setNextCursor(null)
    fetchWorkspace(true)
    return () => fetchAbortRef.current?.abort()
  }, [filters.periodMode, filters.year, filters.month, filters.startDate, filters.endDate, filters.q, filters.status, filters.responsavel, filters.unidade, filters.prioridade, filters.tipoOrdem])

  const selectedSet = useMemo(() => new Set(selectedNotaIds), [selectedNotaIds])
  const rowsWithLinkedNote = useMemo(
    () => rows.filter((row) => Boolean(getRowNotaId(row))),
    [rows]
  )
  const allLoadedSelected = rowsWithLinkedNote.length > 0 && rowsWithLinkedNote.every((row) => {
    const notaId = getRowNotaId(row)
    return notaId ? selectedSet.has(notaId) : false
  })

  function toggleSelection(notaId: string) {
    const normalizedNotaId = normalizeNotaId(notaId)
    if (!normalizedNotaId) return
    setSelectedNotaIds((prev) => {
      if (prev.includes(normalizedNotaId)) return prev.filter((id) => id !== normalizedNotaId)
      return [...prev, normalizedNotaId]
    })
  }

  function toggleSelectAllLoaded() {
    setSelectedNotaIds(() => {
      if (allLoadedSelected) return []
      return Array.from(new Set(rowsWithLinkedNote.map((row) => getRowNotaId(row)).filter(Boolean) as string[]))
    })
  }

  function applyReassignResult(assignments: Array<{ nota_id: string; administrador_destino_id: string }>) {
    if (assignments.length === 0) return
    const assignByNota = new Map(
      assignments
        .map((item) => {
          const notaId = normalizeNotaId(item.nota_id)
          return notaId ? [notaId, item.administrador_destino_id] as const : null
        })
        .filter(Boolean) as Array<readonly [string, string]>
    )
    if (assignByNota.size === 0) return

    setRows((prev) => {
      const updated = prev.map((row) => {
        const notaId = getRowNotaId(row)
        if (!notaId) return row
        const destino = assignByNota.get(notaId)
        if (!destino) return row

        return {
          ...row,
          responsavel_atual_id: destino,
          responsavel_atual_nome: ownerById.get(destino) ?? row.responsavel_atual_nome,
        }
      })

      if (!filters.responsavel || filters.responsavel === 'todos') return updated
      if (filters.responsavel === '__sem_atual__') {
        return updated.filter((row) => {
          const notaId = getRowNotaId(row)
          if (!notaId) return true
          return !assignByNota.has(notaId)
        })
      }
      return updated.filter((row) => row.responsavel_atual_id === filters.responsavel)
    })

    setSelectedNotaIds([])
    fetchWorkspace(true)
  }

  const unitOptions = useMemo(() => {
    const units = Array.from(
      new Set(rows.map((row) => row.unidade).filter(Boolean) as string[])
    )
    return units.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [rows])

  const responsavelOptions = useMemo(() => {
    const options = ownerSummary
      .filter((item) => item.total > 0 || item.administrador_id !== null)
      .map((item) => ({
        value: item.administrador_id ?? '__sem_atual__',
        label: item.nome,
      }))
    return options
  }, [ownerSummary])

  const visibleOwners = useMemo(() => {
    const items = ownerSummary.filter((owner) => (
      owner.total > 0
      || owner.administrador_id === null
      || owner.nome in FIXED_OWNER_CARD_ORDER
    ))

    return items.sort((a, b) => {
      const aRank = FIXED_OWNER_CARD_ORDER[a.nome as keyof typeof FIXED_OWNER_CARD_ORDER]
      const bRank = FIXED_OWNER_CARD_ORDER[b.nome as keyof typeof FIXED_OWNER_CARD_ORDER]

      if (aRank !== undefined && bRank !== undefined) return aRank - bRank
      if (aRank !== undefined) return -1
      if (bRank !== undefined) return 1
      return 0
    })
  }, [ownerSummary])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 8,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1]
    if (!last) return
    if (loadingInitial || loadingMore) return
    if (!nextCursor) return
    if (last.index < rows.length - 20) return
    fetchWorkspace(false)
  }, [virtualRows, loadingInitial, loadingMore, nextCursor, rows.length, fetchWorkspace])

  // Em modo "cards completos", não há scroll da lista para disparar o load-more.
  // Carrega automaticamente todas as páginas restantes.
  useEffect(() => {
    if (ownerCardsViewMode !== 'cards') return
    if (!nextCursor) return
    if (loadingInitial || loadingMore) return
    fetchWorkspace(false)
  }, [ownerCardsViewMode, nextCursor, loadingInitial, loadingMore, fetchWorkspace])

  function handleTabChange(tipo: string) {
    setFilters((prev) => ({ ...prev, tipoOrdem: tipo }))
  }

  function handleOwnerCardsViewModeChange(value: string) {
    const next: PanelViewMode = value === 'cards' ? 'cards' : 'list'
    setOwnerCardsViewMode(next)
    window.localStorage.setItem(OWNER_CARDS_VIEW_MODE_STORAGE_KEY, next)
  }

  function toggleOwnerFilter(ownerKey: string) {
    setFilters((prev) => ({
      ...prev,
      responsavel: prev.responsavel === ownerKey ? 'todos' : ownerKey,
    }))
  }

  return (
    <div className="space-y-4">
      {currentUser.canAccessPmpl && (
        <div className="flex gap-1 rounded-lg border bg-muted/50 p-1 w-fit">
          <button
            type="button"
            onClick={() => handleTabChange('PMOS')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              filters.tipoOrdem === 'PMOS' || !filters.tipoOrdem
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            PMOS <span className="text-muted-foreground font-normal">(Padrão)</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('PMPL')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              filters.tipoOrdem === 'PMPL'
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            PMPL
          </button>
        </div>
      )}
      {filters.tipoOrdem === 'PMPL' && (
        <p className="text-xs text-muted-foreground">
          Ordens sem nota não permitem reatribuição por nota.
        </p>
      )}

      <OrdersKpiStrip
        kpis={workspaceKpisToOrdemNotaKpis(kpis)}
        activeKpi={null}
        criticality={getOrdersCriticalityLevel(kpis.total, kpis.atrasadas)}
        interactive={false}
      />

      <div className="rounded-lg border p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Carteira por colaborador</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select value={ownerCardsViewMode} onValueChange={handleOwnerCardsViewModeChange}>
              <SelectTrigger className="w-44">
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

            {currentUser.canViewGlobal && kpis.sem_responsavel > 0 && (
              <button
                type="button"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                onClick={() => setFilters((prev) => ({ ...prev, responsavel: '__sem_atual__' }))}
              >
                Sem responsável: {formatNumber(kpis.sem_responsavel)}
              </button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilters((prev) => ({ ...prev, responsavel: 'todos' }))}
            >
              Todos
            </Button>
          </div>
        </div>

        {ownerCardsViewMode === 'list' ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {visibleOwners.map((owner) => {
              const ownerKey = owner.administrador_id ?? '__sem_atual__'
              const active = filters.responsavel === ownerKey
              const isSemResponsavel = owner.administrador_id === null
              const ownerCargo = resolveOwnerCargo(owner)

              return (
                <Card
                  key={ownerKey}
                  onClick={() => toggleOwnerFilter(ownerKey)}
                  className={`cursor-pointer p-3 transition-all hover:shadow-md ${
                    active ? 'ring-2 ring-primary bg-primary/5' : ''
                  } ${
                    isSemResponsavel ? 'border-orange-200 bg-orange-50/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="relative shrink-0">
                      <Avatar src={owner.avatar_url} nome={owner.nome} size="md" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{owner.nome}</p>
                      <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CARGO_BADGE[ownerCargo]?.color ?? CARGO_BADGE['GERAL'].color}`}>
                        {ownerCargo}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex gap-1.5">
                    <span className="flex-1 rounded bg-emerald-50 py-0.5 text-center text-xs font-bold text-emerald-700">
                      {formatNumber(owner.recentes)}
                    </span>
                    <span className="flex-1 rounded bg-amber-50 py-0.5 text-center text-xs font-bold text-amber-700">
                      {formatNumber(owner.atencao)}
                    </span>
                    <span className="flex-1 rounded bg-red-50 py-0.5 text-center text-xs font-bold text-red-700">
                      {formatNumber(owner.atrasadas)}
                    </span>
                  </div>

                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>Rec.</span>
                    <span>Atenc.</span>
                    <span>Atras.</span>
                  </div>

                  <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                    Total: {formatNumber(owner.total)} ordens
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {ownerGroups.map((group) => (
              <OrdersOwnerFullCard
                key={group.id}
                group={group}
                canReassign={canReassign}
                reassignTargets={reassignTargets}
                selectedNotaIds={selectedNotaIdsSet}
                onToggleRowSelection={(notaId) => {
                  setSelectedNotaIds((prev) =>
                    prev.includes(notaId) ? prev.filter((id) => id !== notaId) : [...prev, notaId]
                  )
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-2 rounded-lg border p-3 lg:grid-cols-6">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar por nota, ordem ou descrição"
          className="lg:col-span-2"
        />

        <Select
          value={filters.periodMode}
          onValueChange={(value) => setFilters((prev) => ({ ...prev, periodMode: value as OrdersPeriodModeOperational }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_MODE_LABELS.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filters.periodMode === 'year' && (
          <Select
            value={String(filters.year ?? years[0])}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, year: Number(value) }))}
          >
            <SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {filters.periodMode === 'year_month' && (
          <>
            <Select
              value={String(filters.year ?? years[0])}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, year: Number(value) }))}
            >
              <SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(filters.month ?? 1)}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, month: Number(value) }))}
            >
              <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((month) => (
                  <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {filters.periodMode === 'month' && (
          <Select
            value={String(filters.month ?? 1)}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, month: Number(value) }))}
          >
            <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
            <SelectContent>
              {MONTH_LABELS.map((month) => (
                <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {filters.periodMode === 'range' && (
          <>
            <Input
              type="date"
              value={filters.startDate ?? ''}
              onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value || null }))}
            />
            <Input
              type="date"
              value={filters.endDate ?? ''}
              onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value || null }))}
            />
          </>
        )}

        <Select
          value={filters.status || 'todas'}
          onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
        >
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.prioridade || 'todas'}
          onValueChange={(value) => setFilters((prev) => ({ ...prev, prioridade: value }))}
        >
          <SelectTrigger><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            {PRIORIDADE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {currentUser.canViewGlobal && (
          <Select
            value={filters.responsavel || 'todos'}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, responsavel: value }))}
          >
            <SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os responsáveis</SelectItem>
              {responsavelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Input
          list="workspace-unidades"
          value={filters.unidade}
          onChange={(event) => setFilters((prev) => ({ ...prev, unidade: event.target.value }))}
          placeholder="Unidade"
        />
        <datalist id="workspace-unidades">
          {unitOptions.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>

        <div className="flex items-center justify-end gap-2 lg:col-span-2">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={allLoadedSelected} onChange={toggleSelectAllLoaded} />
            Selecionar carregadas
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => exportOrdersToXlsx(rows)} disabled={rows.length === 0}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Exportar planilha
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fetchWorkspace(true)}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      {canReassign && selectedNotaIds.length > 0 && (
        <div className="sticky bottom-4 z-40">
          <OrdersBulkReassignBar
            selectedNotaIds={selectedNotaIds}
            admins={reassignTargets}
            onClearSelection={() => setSelectedNotaIds([])}
            skipRouterRefresh
            onSuccess={(result) => applyReassignResult(result.rows)}
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div
        ref={parentRef}
        className="h-[68vh] overflow-auto rounded-lg border"
      >
        {loadingInitial ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando ordens...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhuma ordem para os filtros aplicados.
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index]
              const notaId = getRowNotaId(row)
              const selected = notaId ? selectedSet.has(notaId) : false

              return (
                <div
                  key={row.ordem_id}
                  className="absolute left-0 top-0 w-full px-3 py-2"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <OrderCompactCard
                    row={row}
                    selected={selected}
                    showCheckbox
                    onToggleSelection={toggleSelection}
                    showReassign={canReassign && reassignTargets.length > 0}
                    reassignProps={{
                      currentAdminId: row.responsavel_atual_id,
                      admins: reassignTargets,
                      skipRouterRefresh: true,
                      onReassigned: ({ notaId, novoAdminId }) => {
                        applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
                      },
                    }}
                    onOpenDetails={() => setDetailRow(row)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {loadingMore && (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando mais ordens...
        </div>
      )}

      <OrdersDetailDrawer
        open={Boolean(detailRow)}
        onOpenChange={(next) => !next && setDetailRow(null)}
        ordemId={detailRow?.ordem_id ?? null}
        notaId={detailRow ? getRowNotaId(detailRow) : null}
        row={detailRow}
        canReassign={canReassign}
        reassignTargets={reassignTargets}
        onReassigned={({ notaId, novoAdminId }) => {
          applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
        }}
      />

    </div>
  )
}
