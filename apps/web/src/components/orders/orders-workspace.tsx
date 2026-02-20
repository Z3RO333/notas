'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Download,
  LayoutGrid,
  ListChecks,
  Loader2,
  LoaderCircle,
  RefreshCcw,
  Rows3,
  ShieldCheck,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import { OrderReassignDialog } from '@/components/orders/order-reassign-dialog'
import { OrdersDetailDrawer } from '@/components/orders/orders-detail-drawer'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
} from '@/lib/orders/metrics'
import type {
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

function sanitizeText(value: string): string {
  return value.trim()
}

function formatIsoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR')
}

function formatDelayText(row: Pick<OrdemNotaAcompanhamento, 'semaforo_atraso' | 'dias_em_aberto'>): string {
  if (row.semaforo_atraso !== 'vermelho') return `${row.dias_em_aberto} dia(s) em aberto`
  // Semáforo vermelho começa em 7 dias; atraso real é o excedente ao prazo.
  const delayDays = Math.max(1, row.dias_em_aberto - 6)
  return `${delayDays} dia(s) de atraso`
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

function resolveKpiFrameClass(total: number, overdue: number): string {
  if (total <= 0 || overdue <= 0) return 'border-border'

  const ratio = overdue / Math.max(total, 1)
  if (overdue >= 20 || ratio >= 0.35) return 'border-red-300 bg-red-50/30'
  if (overdue >= 6 || ratio >= 0.15) return 'border-amber-300 bg-amber-50/30'
  return 'border-border'
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
      setCurrentUser(payload.currentUser)
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
  }, [filters.periodMode, filters.year, filters.month, filters.startDate, filters.endDate, filters.q, filters.status, filters.responsavel, filters.unidade, filters.prioridade])

  const selectedSet = useMemo(() => new Set(selectedNotaIds), [selectedNotaIds])
  const allLoadedSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.nota_id))

  function toggleSelection(notaId: string) {
    setSelectedNotaIds((prev) => {
      if (prev.includes(notaId)) return prev.filter((id) => id !== notaId)
      return [...prev, notaId]
    })
  }

  function toggleSelectAllLoaded() {
    setSelectedNotaIds(() => {
      if (allLoadedSelected) return []
      return Array.from(new Set(rows.map((row) => row.nota_id)))
    })
  }

  function applyReassignResult(assignments: Array<{ nota_id: string; administrador_destino_id: string }>) {
    if (assignments.length === 0) return
    const assignByNota = new Map(assignments.map((item) => [item.nota_id, item.administrador_destino_id]))

    setRows((prev) => {
      const updated = prev.map((row) => {
        const destino = assignByNota.get(row.nota_id)
        if (!destino) return row

        return {
          ...row,
          responsavel_atual_id: destino,
          responsavel_atual_nome: ownerById.get(destino) ?? row.responsavel_atual_nome,
        }
      })

      if (!filters.responsavel || filters.responsavel === 'todos') return updated
      if (filters.responsavel === '__sem_atual__') return updated.filter((row) => !assignByNota.has(row.nota_id))
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

  const visibleOwners = useMemo(
    () => ownerSummary.filter((owner) => owner.total > 0 || owner.administrador_id === null),
    [ownerSummary]
  )

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
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

  const kpiFrameClass = resolveKpiFrameClass(kpis.total, kpis.atrasadas)
  const kpiCards = [
    {
      key: 'total',
      label: 'Total de ordens',
      value: kpis.total,
      helper: 'Visão geral',
      icon: ListChecks,
      valueClass: 'text-foreground',
    },
    {
      key: 'em_aberto',
      label: 'Em processamento',
      value: kpis.abertas,
      helper: 'Status em processamento',
      icon: BarChart3,
      valueClass: 'text-sky-700',
    },
    {
      key: 'em_execucao',
      label: 'Em execução',
      value: kpis.em_tratativa,
      helper: 'EM_EXECUCAO + EQUIPAMENTO_EM_CONSERTO',
      icon: LoaderCircle,
      valueClass: 'text-indigo-700',
    },
    {
      key: 'em_avaliacao',
      label: 'Em avaliação',
      value: kpis.em_avaliacao,
      helper: 'Status AVALIACAO_DA_EXECUCAO',
      icon: ShieldCheck,
      valueClass: 'text-emerald-700',
    },
    {
      key: 'avaliadas',
      label: 'Avaliadas',
      value: kpis.avaliadas,
      helper: 'Status EXECUCAO_SATISFATORIO',
      icon: ClipboardCheck,
      valueClass: 'text-amber-700',
    },
    {
      key: 'atrasadas',
      label: 'Atrasadas (7+)',
      value: kpis.atrasadas,
      helper: 'Abertas/em execução (7+ dias)',
      icon: AlertTriangle,
      valueClass: 'text-red-700',
    },
  ] as const

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
      <div className={`rounded-lg border p-2 ${kpiFrameClass}`}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {kpiCards.map((item) => {
            const Icon = item.icon
            return (
              <Card key={item.key} className="h-full">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <CardTitle className="min-h-[2.5rem] flex-1 pr-2 text-sm font-medium leading-tight text-muted-foreground">
                    {item.label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className={`text-3xl font-bold ${item.valueClass}`}>{formatNumber(item.value)}</p>
                  <p className="min-h-[2rem] text-xs leading-4 text-muted-foreground">{item.helper}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

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
                      <div className="flex items-center gap-1">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {formatNumber(owner.total)} ordens
                        </span>
                      </div>
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
                    {formatNumber(owner.abertas)} ordens abertas
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {visibleOwners.map((owner) => {
              const ownerKey = owner.administrador_id ?? '__sem_atual__'
              const active = filters.responsavel === ownerKey
              const isSemResponsavel = owner.administrador_id === null

              return (
                <Card
                  key={ownerKey}
                  onClick={() => toggleOwnerFilter(ownerKey)}
                  className={`cursor-pointer p-4 transition-all hover:shadow-md ${
                    active ? 'ring-2 ring-primary bg-primary/5' : ''
                  } ${
                    isSemResponsavel ? 'border-orange-200 bg-orange-50/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <Avatar src={owner.avatar_url} nome={owner.nome} size="lg" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{owner.nome}</p>
                      <div className="flex items-center gap-1">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {formatNumber(owner.total)} ordens
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-emerald-50 px-2 py-1">
                      <p className="text-lg font-bold text-emerald-700">{formatNumber(owner.recentes)}</p>
                      <p className="text-[11px] text-emerald-700">0-2d</p>
                    </div>
                    <div className="rounded bg-amber-50 px-2 py-1">
                      <p className="text-lg font-bold text-amber-700">{formatNumber(owner.atencao)}</p>
                      <p className="text-[11px] text-amber-700">3-6d</p>
                    </div>
                    <div className="rounded bg-red-50 px-2 py-1">
                      <p className="text-lg font-bold text-red-700">{formatNumber(owner.atrasadas)}</p>
                      <p className="text-[11px] text-red-700">7+d</p>
                    </div>
                  </div>

                  <div className="mt-3 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="font-semibold">{formatNumber(owner.abertas)}</span> ordens abertas
                  </div>
                </Card>
              )
            })}
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
              const selected = selectedSet.has(row.nota_id)
              const overdue = row.semaforo_atraso === 'vermelho'

              return (
                <div
                  key={row.ordem_id}
                  className={`absolute left-0 top-0 w-full border-b px-3 py-2 ${
                    overdue ? 'bg-red-50/60' : 'bg-background'
                  } ${selected ? 'ring-1 ring-primary inset-x-1' : ''}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={() => setDetailRow(row)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleSelection(row.nota_id)}
                        aria-label={`Selecionar nota ${row.numero_nota}`}
                      />

                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold">
                          {row.numero_nota} • Ordem {row.ordem_codigo}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{row.descricao ?? 'Sem descrição'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                            {getSemaforoLabel(row.semaforo_atraso)}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${getOrderStatusClass(row.status_ordem)}`}>
                            {getOrderStatusLabel(row.status_ordem)}
                          </span>
                          <span className="text-muted-foreground">{row.unidade ?? 'Sem unidade'}</span>
                          <span className="text-muted-foreground">{formatDelayText(row)}</span>
                          <span className="text-muted-foreground">{formatIsoDate(row.ordem_detectada_em)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      {overdue && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-[11px] font-medium text-red-700">
                          <AlertTriangle className="h-3 w-3" />
                          {formatDelayText(row)}
                        </span>
                      )}

                      {canReassign && reassignTargets.length > 0 && (
                        <OrderReassignDialog
                          notaId={row.nota_id}
                          notaNumero={row.numero_nota}
                          ordemCodigo={row.ordem_codigo}
                          currentAdminId={row.responsavel_atual_id}
                          admins={reassignTargets}
                          skipRouterRefresh
                          onReassigned={({ notaId, novoAdminId }) => {
                            applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
                          }}
                        />
                      )}
                    </div>
                  </div>
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
        notaId={detailRow?.nota_id ?? null}
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
