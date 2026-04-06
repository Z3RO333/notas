'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Copy, Download, LayoutGrid, Loader2, Clock3, RefreshCcw, Rows3, TimerReset } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import { OperacionaisEmCampoDialog } from '@/components/orders/operacionais-em-campo-dialog'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import { OrdersDetailDrawer } from '@/components/orders/orders-detail-drawer'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersOwnerFullCard } from '@/components/orders/orders-owner-full-card'
import { OrdersPendingSyncSection } from '@/components/orders/orders-pending-sync-section'
import { OrdersPriorityLane, PRIORITY_LANE_CONFIG } from '@/components/orders/orders-priority-lane'
import { OrdersPoolCard } from '@/components/orders/orders-pool-card'
import { resolveOrdersWorkspacePresentation } from '@/components/orders/orders-workspace-presentation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/components/ui/toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getOrdersCriticalityLevel, getRawStatusLabel, getSemaforoLabel, workspaceKpisToOrdemNotaKpis, SEMAFORO_OPTIONS } from '@/lib/orders/metrics'
import { cn } from '@/lib/utils'
import { UNASSIGNED_ORDER_OWNER_KEY, buildVisibleOwnerSummary, hasIndividualOwnerSelection, toOrderOwnerKey } from '@/lib/orders/owner-visibility'
import { shouldHideOwnerOutsidePmpl } from '@/lib/admin/admin-identity-catalog'
import { resolveCargoPresentationFromOwner } from '@/lib/collaborator/cargo-presentation'
import { buildCopyPayload, copyToClipboard } from '@/lib/orders/copy'
import { isRawOrderActive } from '@/lib/orders/status-raw'
import { fetchAllFilteredOrderCodes } from '@/lib/orders/workspace-copy'
import { useOrdersFilters, sanitizeText } from '@/components/orders/use-orders-filters'
import { useOrdersData } from '@/components/orders/use-orders-data'
import type {
  Especialidade,
  OrderOwnerGroup,
  OrdersPoolGroup,
  OrdersPeriodModeOperational,
  PanelViewMode,
  OrdersWorkspaceFilters,
  OrdemNotaAcompanhamento,
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

function utcYmd(offsetDays = 0): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('-')
}

function utcFirstOfMonth(): string {
  const d = new Date()
  return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), '01'].join('-')
}

const DATE_PRESETS = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'mes', label: 'Mês atual' },
  { value: 'custom', label: 'Personalizado' },
] as const

function detectDatePreset(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) return 'custom'
  const today = utcYmd(0)
  if (startDate === today && endDate === today) return 'hoje'
  if (startDate === utcYmd(1) && endDate === utcYmd(1)) return 'ontem'
  if (startDate === utcYmd(6) && endDate === today) return '7d'
  if (startDate === utcYmd(29) && endDate === today) return '30d'
  if (startDate === utcFirstOfMonth() && endDate === today) return 'mes'
  return 'custom'
}

const PERIOD_MODE_LABELS: Array<{
  value: OrdersPeriodModeOperational
  label: string
}> = [
  { value: 'all', label: 'Todo histórico' },
  { value: 'year', label: 'Ano' },
  { value: 'year_month', label: 'Ano + mês' },
  { value: 'month', label: 'Mês (todos os anos)' },
  { value: 'range', label: 'Intervalo específico' },
]

const STATUS_OPTIONS = [
  { value: 'ativas', label: 'Ativas (padrão)' },
  { value: 'todas', label: 'Todo o histórico' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_tratativa', label: 'Em execução' },
  { value: 'em_avaliacao', label: 'Em avaliação' },
  { value: 'avaliadas', label: 'Avaliadas' },
  { value: 'nao_realizada', label: 'Não realizada' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'desconhecido', label: 'Desconhecido' },
]

const PRIORIDADE_OPTIONS = [
  { value: 'todas', label: 'Todas prioridades' },
  ...SEMAFORO_OPTIONS,
]

const OWNER_CARDS_VIEW_MODE_STORAGE_KEY = 'cockpit:ordens:owner-cards:view-mode'
const AUTO_LOAD_MAX_ROWS = 300


function formatIsoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR')
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

async function exportOrdersToXlsx(rows: OrdemNotaAcompanhamento[]) {
  const XLSX = await import('xlsx')
  const data = rows.map((row) => ({
    Ordem: row.ordem_codigo,
    Nota: row.numero_nota,
    Status: getRawStatusLabel(row.status_ordem_raw),
    'Status RAW': row.status_ordem_raw ?? '',
    Centro: row.centro ?? '',
    Unidade: row.unidade ?? '',
    Responsável: row.administrador_nome ?? 'Sem responsável',
    Semáforo: getSemaforoLabel(row.semaforo_atraso),
    'Dias em aberto': row.dias_em_aberto,
    'Detectada em': formatIsoDate(row.ordem_detectada_em),
    Descrição: row.descricao ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ordens')
  const filename = `ordens_${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(wb, filename)
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

export function OrdersWorkspace({ initialFilters, initialUser }: OrdersWorkspaceProps) {
  const { toast } = useToast()
  const years = useMemo(() => makeYearOptions(), [])
  const [selectedNotaIds, setSelectedNotaIds] = useState<string[]>([])
  const [detailRow, setDetailRow] = useState<OrdemNotaAcompanhamento | null>(null)
  const [ownerCardsViewMode, setOwnerCardsViewMode] = useState<PanelViewMode>(
    () => resolveOrdersWorkspacePresentation(initialUser.role).defaultOwnerCardsViewMode
  )
  const [copyFilterLoading, setCopyFilterLoading] = useState(false)

  // --- Filter state ---
  const { filters, setFilters, searchInput, setSearchInput, searchInputRef, pendingSearchEnterActionRef } = useOrdersFilters({
    initialFilters,
    canViewGlobal: initialUser.canViewGlobal,
  })

  // Copy helpers defined before handleResetSuccess
  function getPrimaryCopyTarget(row: OrdemNotaAcompanhamento): { label: 'ORDEM' | 'NOTA'; value: string } | null {
    const ordem = row.ordem_codigo?.trim()
    if (ordem) return { label: 'ORDEM', value: ordem }
    const nota = row.numero_nota?.trim()
    if (nota) return { label: 'NOTA', value: nota }
    return null
  }

  const copyFromRow = useCallback(
    async (row: OrdemNotaAcompanhamento | null | undefined) => {
      if (!row) {
        toast({ title: 'Nenhum resultado para copiar', variant: 'info' })
        return
      }
      setDetailRow(row)
      const target = getPrimaryCopyTarget(row)
      if (!target) {
        toast({ title: 'Resultado sem código copiável', variant: 'info' })
        return
      }
      const copied = await copyToClipboard(target.value)
      if (!copied) {
        toast({
          title: `Falha ao copiar ${target.label}`,
          description: 'Não foi possível copiar para a área de transferência.',
          variant: 'error',
        })
        return
      }
      toast({ title: `${target.label} ${target.value} copiada ✅`, variant: 'success' })
    },
    [toast],
  )

  const handleResetSuccess = useCallback(
    async (resetRows: OrdemNotaAcompanhamento[]) => {
      setSelectedNotaIds([])
      if (pendingSearchEnterActionRef.current) {
        pendingSearchEnterActionRef.current = false
        await copyFromRow(resetRows[0])
      }
    },
    [copyFromRow, pendingSearchEnterActionRef],
  )

  // --- Data + smart search ---
  const {
    rows, setRows, pendingSyncRows, setPendingSyncRows, unitOptions: fetchedUnitOptions, kpis, ownerSummary, reassignTargets, poolGroups, poolCentros, highlights,
    nextCursor, loadingInitial, loadingMore, error, currentUser, parentRef, smartSearch, effectiveFilters, fetchWorkspace,
  } = useOrdersData({
    filters,
    initialUser,
    onResetSuccess: handleResetSuccess,
  })

  const presentation = useMemo(
    () => resolveOrdersWorkspacePresentation(currentUser.role),
    [currentUser.role],
  )
  const canReassign = currentUser.role === 'gestor' && currentUser.canViewGlobal
  const isPrivateScope = !currentUser.canViewGlobal

  // Guard: reset tipoOrdem when user loses PMPL access (bridges data + filter hooks)
  useEffect(() => {
    if (currentUser.canAccessPmpl) return
    if (filters.tipoOrdem !== 'PMPL') return
    setFilters((prev) => ({ ...prev, tipoOrdem: 'PMOS' }))
  }, [currentUser.canAccessPmpl, filters.tipoOrdem, setFilters])

  // Restore persisted view mode on mount
  useEffect(() => {
    if (presentation.isViewerMode) {
      setOwnerCardsViewMode('list')
      return
    }
    const persisted = window.localStorage.getItem(OWNER_CARDS_VIEW_MODE_STORAGE_KEY)
    if (persisted === 'list' || persisted === 'cards') {
      setOwnerCardsViewMode(persisted)
    }
  }, [presentation.isViewerMode])

  const ownerById = useMemo(() => {
    const map = new Map<string, string>()
    for (const target of reassignTargets) {
      map.set(target.id, target.nome)
    }
    return map
  }, [reassignTargets])
  const ownerEspecialidadeById = useMemo(() => {
    const map = new Map<string, Especialidade | null>()
    for (const target of reassignTargets) {
      map.set(target.id, target.especialidade ?? null)
    }
    return map
  }, [reassignTargets])

  const selectedNotaIdsSet = useMemo(() => new Set(selectedNotaIds), [selectedNotaIds])
  const hasListScopeFilters = Boolean(
    filters.q ||
    (filters.status && filters.status !== 'todas') ||
    (filters.responsavel && filters.responsavel !== 'todos') ||
    filters.unidade ||
    (filters.prioridade && filters.prioridade !== 'todas'),
  )
  const hasSelectedOwnerFilter = hasIndividualOwnerSelection(currentUser.canViewGlobal, filters.responsavel)
  const selectedOwnerKey = hasSelectedOwnerFilter ? filters.responsavel.trim() : null

  const ownerGroups = useMemo((): OrderOwnerGroup[] => {
    if (ownerCardsViewMode !== 'cards') return []

    const scopedOwnerSummary = isPrivateScope ? ownerSummary.filter((item) => item.administrador_id === currentUser.adminId) : ownerSummary

    // Agrupar rows carregados por responsável (para a lista de itens)
    // Exclui concluídas/canceladas — o card exibe apenas ordens ativas.
    const rowsByOwner = new Map<string, OrdemNotaAcompanhamento[]>()
    for (const row of rows) {
      if (!isRawOrderActive(row.status_ordem_raw)) continue
      const id = toOrderOwnerKey(row.responsavel_atual_id)
      const bucket = rowsByOwner.get(id) ?? []
      bucket.push(row)
      rowsByOwner.set(id, bucket)
    }

    return scopedOwnerSummary
      .filter((s) => {
        if (s.total <= 0) return false
        // Gustavo deve aparecer na aba PMPL; em PMOS mantém regra legada de ocultar.
        if (filters.tipoOrdem !== 'PMPL' && shouldHideOwnerOutsidePmpl(s.nome)) return false
        if (!selectedOwnerKey) return true
        return toOrderOwnerKey(s.administrador_id) === selectedOwnerKey
      })
      .map((s) => {
        const ownerRows = rowsByOwner.get(toOrderOwnerKey(s.administrador_id)) ?? []
        return {
          id: toOrderOwnerKey(s.administrador_id),
          nome: s.nome,
          avatar_url: s.avatar_url,
          especialidade: s.administrador_id ? (ownerEspecialidadeById.get(s.administrador_id) ?? null) : null,
          rows: ownerRows,
          recentes: s.recentes,
          atencao: s.atencao,
          atrasadas: s.atrasadas,
          abertas: s.abertas,
          total: s.total,
        }
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [rows, ownerCardsViewMode, ownerSummary, filters.tipoOrdem, ownerEspecialidadeById, isPrivateScope, currentUser.adminId, selectedOwnerKey])

  const poolGroupsWithRows = useMemo((): OrdersPoolGroup[] => {
    if (!currentUser.canViewGlobal || ownerCardsViewMode !== 'cards') return []
    const rowsByPool = new Map<string, OrdemNotaAcompanhamento[]>()
    for (const row of rows) {
      if (row.responsavel_atual_id !== null) continue
      if (!row.centro) continue
      const poolNome = poolCentros[row.centro]
      if (!poolNome) continue
      const bucket = rowsByPool.get(poolNome) ?? []
      bucket.push(row)
      rowsByPool.set(poolNome, bucket)
    }
    return poolGroups
      .filter((g) => g.total > 0)
      .map((g) => ({ ...g, rows: rowsByPool.get(g.pool_nome) ?? [] }))
  }, [rows, poolGroups, poolCentros, ownerCardsViewMode, currentUser.canViewGlobal])

  const rowsWithLinkedNote = useMemo(() => rows.filter((row) => Boolean(getRowNotaId(row))), [rows])
  const allLoadedSelected = useMemo(
    () =>
      rowsWithLinkedNote.length > 0 &&
      rowsWithLinkedNote.every((row) => {
        const notaId = getRowNotaId(row)
        return notaId ? selectedNotaIdsSet.has(notaId) : false
      }),
    [rowsWithLinkedNote, selectedNotaIdsSet],
  )

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
          return notaId ? ([notaId, item.administrador_destino_id] as const) : null
        })
        .filter(Boolean) as Array<readonly [string, string]>,
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
      if (filters.responsavel === UNASSIGNED_ORDER_OWNER_KEY) {
        return updated.filter((row) => {
          const notaId = getRowNotaId(row)
          if (!notaId) return true
          return !assignByNota.has(notaId)
        })
      }
      return updated.filter((row) => row.responsavel_atual_id === filters.responsavel)
    })

    setPendingSyncRows((prev) => prev.map((row) => {
      const notaId = getRowNotaId(row)
      if (!notaId) return row
      const destino = assignByNota.get(notaId)
      if (!destino) return row

      return {
        ...row,
        responsavel_atual_id: destino,
        responsavel_atual_nome: ownerById.get(destino) ?? row.responsavel_atual_nome,
      }
    }))

    setSelectedNotaIds([])
    fetchWorkspace(true)
  }

  const unitOptions = useMemo(() => {
    const units = [...fetchedUnitOptions]
    if (filters.unidade?.trim() && !units.includes(filters.unidade)) {
      units.push(filters.unidade)
    }
    return units.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [fetchedUnitOptions, filters.unidade])

  const unitSelectOptions = useMemo(() => (
    [
      { value: '', label: 'Todas as unidades' },
      ...unitOptions.map((unit) => ({ value: unit, label: unit })),
    ]
  ), [unitOptions])

  const responsavelOptions = useMemo(() => {
    const options = ownerSummary
      .filter((item) => item.total > 0 || item.administrador_id !== null)
      .map((item) => ({
        value: toOrderOwnerKey(item.administrador_id),
        label: item.nome,
      }))
    return options
  }, [ownerSummary])
  const priorityTotals = useMemo(() => {
    return ownerSummary.reduce(
      (acc, owner) => {
        acc.oldest += owner.atrasadas
        acc.attention += owner.atencao
        return acc
      },
      { oldest: 0, attention: 0 },
    )
  }, [ownerSummary])
  const periodControlsClassName = cn(
    'grid gap-2 sm:grid-cols-2',
    filters.periodMode === 'range' ? 'xl:grid-cols-4' : filters.periodMode === 'year_month' ? 'xl:grid-cols-3' : filters.periodMode === 'all' ? 'xl:grid-cols-1' : 'xl:grid-cols-2',
  )

  const handleCopyFilteredOrders = useCallback(async () => {
    setCopyFilterLoading(true)

    try {
      const { codes } = await fetchAllFilteredOrderCodes(effectiveFilters)
      const payload = buildCopyPayload(codes)

      if (!payload) {
        toast({
          title: 'Nenhuma ordem para copiar',
          description: 'Nenhuma ordem do filtro atual possui código copiável.',
          variant: 'info',
        })
        return
      }

      const copied = await copyToClipboard(payload)
      if (!copied) {
        toast({
          title: 'Falha ao copiar filtro',
          description: 'Não foi possível copiar para a área de transferência.',
          variant: 'error',
        })
        return
      }

      toast({
        title: 'Ordens do filtro copiadas',
        description: `${payload.split('\n').length} ordens prontas para colar no SAP.`,
        variant: 'success',
      })
    } catch (error) {
      toast({
        title: 'Falha ao copiar filtro',
        description: error instanceof Error ? error.message : 'Não foi possível carregar as ordens do filtro atual.',
        variant: 'error',
      })
    } finally {
      setCopyFilterLoading(false)
    }
  }, [effectiveFilters, toast])

  const visibleOwners = useMemo(() => {
    return buildVisibleOwnerSummary({
      ownerSummary,
      canViewGlobal: currentUser.canViewGlobal,
      isPrivateScope,
      currentAdminId: currentUser.adminId,
      tipoOrdem: filters.tipoOrdem,
      responsavel: filters.responsavel,
      hasScopedFilters: hasListScopeFilters,
    })
  }, [ownerSummary, filters.tipoOrdem, filters.responsavel, currentUser.canViewGlobal, currentUser.adminId, isPrivateScope, hasListScopeFilters])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 8,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const autoLoadEnabled = presentation.showWorkspaceTable && ownerCardsViewMode === 'list' && rows.length < AUTO_LOAD_MAX_ROWS
  const showManualLoadMore = presentation.showWorkspaceTable && ownerCardsViewMode === 'list' && rows.length >= AUTO_LOAD_MAX_ROWS

  useEffect(() => {
    if (!autoLoadEnabled) return
    const last = virtualRows[virtualRows.length - 1]
    if (!last) return
    if (loadingInitial || loadingMore) return
    if (!nextCursor) return
    if (last.index < rows.length - 20) return
    fetchWorkspace(false, nextCursor)
  }, [autoLoadEnabled, virtualRows, loadingInitial, loadingMore, nextCursor, rows.length, fetchWorkspace])

  function handleTabChange(tipo: string) {
    setFilters((prev) => ({ ...prev, tipoOrdem: tipo }))
  }

  function handleOwnerCardsViewModeChange(value: string) {
    if (presentation.isViewerMode) return
    const next: PanelViewMode = value === 'cards' ? 'cards' : 'list'
    setOwnerCardsViewMode(next)
    window.localStorage.setItem(OWNER_CARDS_VIEW_MODE_STORAGE_KEY, next)
  }

  function toggleOwnerFilter(ownerKey: string) {
    if (isPrivateScope) return
    setFilters((prev) => ({
      ...prev,
      responsavel: prev.responsavel === ownerKey ? 'todos' : ownerKey,
    }))
  }

  const selectAndCopyFirstResult = useCallback(async () => {
    await copyFromRow(rows[0])
  }, [rows, copyFromRow])

  function handleDatePreset(preset: string) {
    const today = utcYmd(0)
    const ranges: Record<string, { start: string; end: string }> = {
      hoje: { start: today, end: today },
      ontem: { start: utcYmd(1), end: utcYmd(1) },
      '7d': { start: utcYmd(6), end: today },
      '30d': { start: utcYmd(29), end: today },
      mes: { start: utcFirstOfMonth(), end: today },
    }
    const range = ranges[preset]
    if (range) {
      setFilters((prev) => ({
        ...prev,
        periodMode: 'range',
        startDate: range.start,
        endDate: range.end,
      }))
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()

    const clean = sanitizeText(searchInput)
    if (clean !== filters.q) {
      pendingSearchEnterActionRef.current = true
      setFilters((prev) => (prev.q === clean ? prev : { ...prev, q: clean }))
      return
    }

    void selectAndCopyFirstResult()
  }

  return (
    <div className="space-y-4">
      {currentUser.canAccessPmpl && (
        <div className="flex gap-1 rounded-lg border bg-muted/50 p-1 w-fit">
          <button
            type="button"
            onClick={() => handleTabChange('PMOS')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              filters.tipoOrdem === 'PMOS' || !filters.tipoOrdem ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            PMOS <span className="text-muted-foreground font-normal">(Padrão)</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('PMPL')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              filters.tipoOrdem === 'PMPL' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            PMPL
          </button>
        </div>
      )}
      {filters.tipoOrdem === 'PMPL' && <p className="text-xs text-muted-foreground">Ordens sem nota não permitem reatribuição por nota.</p>}

      <OrdersKpiStrip kpis={workspaceKpisToOrdemNotaKpis(kpis)} activeKpi={null} criticality={getOrdersCriticalityLevel(kpis.total, kpis.atrasadas)} interactive={false} loading={loadingInitial} />

      {!presentation.isViewerMode && hasListScopeFilters && (
        <p className="text-xs text-muted-foreground">
          Os KPIs acima mostram o total canônico do período e do tipo de ordem selecionado. Os filtros abaixo afetam a carteira, a listagem e a distribuição por colaborador.
        </p>
      )}

      <OrdersPendingSyncSection
        rows={pendingSyncRows}
        highlightQuery={smartSearch.highlightQuery}
        canReassign={canReassign}
        reassignTargets={reassignTargets}
        onOpenDetails={setDetailRow}
        onReassigned={({ notaId, novoAdminId }) => {
          applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
        }}
      />

      {presentation.showPriorityLanes && <div className="grid gap-4 xl:grid-cols-2">
        <OrdersPriorityLane
          title={PRIORITY_LANE_CONFIG.oldest.title}
          description={PRIORITY_LANE_CONFIG.oldest.description}
          emptyMessage={PRIORITY_LANE_CONFIG.oldest.emptyMessage}
          actionLabel={PRIORITY_LANE_CONFIG.oldest.actionLabel}
          total={priorityTotals.oldest}
          rows={highlights.oldest}
          icon={PRIORITY_LANE_CONFIG.oldest.icon}
          tone={PRIORITY_LANE_CONFIG.oldest.tone}
          highlightQuery={smartSearch.highlightQuery}
          canReassign={canReassign}
          reassignTargets={reassignTargets}
          onAction={() =>
            setFilters((prev) => ({
              ...prev,
              status: 'ativas',
              prioridade: 'vermelho',
            }))
          }
          onOpenDetails={setDetailRow}
          onReassigned={({ notaId, novoAdminId }) => {
            applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
          }}
        />

        <OrdersPriorityLane
          title={PRIORITY_LANE_CONFIG.attention.title}
          description={PRIORITY_LANE_CONFIG.attention.description}
          emptyMessage={PRIORITY_LANE_CONFIG.attention.emptyMessage}
          actionLabel={PRIORITY_LANE_CONFIG.attention.actionLabel}
          total={priorityTotals.attention}
          rows={highlights.attention}
          icon={PRIORITY_LANE_CONFIG.attention.icon}
          tone={PRIORITY_LANE_CONFIG.attention.tone}
          highlightQuery={smartSearch.highlightQuery}
          canReassign={canReassign}
          reassignTargets={reassignTargets}
          onAction={() =>
            setFilters((prev) => ({
              ...prev,
              status: 'ativas',
              prioridade: 'amarelo',
            }))
          }
          onOpenDetails={setDetailRow}
          onReassigned={({ notaId, novoAdminId }) => {
            applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
          }}
        />
      </div>}

      <div className="rounded-lg border p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Carteira por colaborador</p>
          {presentation.showOwnerToolbar && <div className="flex flex-wrap items-center justify-end gap-2">
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

            {!presentation.isViewerMode && currentUser.canViewGlobal && kpis.sem_responsavel > 0 && (
              <button
                type="button"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    responsavel: UNASSIGNED_ORDER_OWNER_KEY,
                  }))
                }
              >
                Sem responsável: {formatNumber(kpis.sem_responsavel)}
              </button>
            )}
            {!presentation.isViewerMode && currentUser.canViewGlobal && (
              <Button type="button" variant="outline" size="sm" onClick={() => setFilters((prev) => ({ ...prev, responsavel: 'todos' }))}>
                Todos
              </Button>
            )}
          </div>}
        </div>

        {ownerCardsViewMode === 'list' ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {visibleOwners.map((owner) => {
              const ownerKey = toOrderOwnerKey(owner.administrador_id)
              const active = isPrivateScope ? false : filters.responsavel === ownerKey
              const ownerCargo = resolveCargoPresentationFromOwner({
                administrador_id: owner.administrador_id,
                nome: owner.nome,
                especialidade: owner.administrador_id ? (ownerEspecialidadeById.get(owner.administrador_id) ?? null) : null,
              })

              return (
                <CollaboratorCardShell
                  key={ownerKey}
                  variant="operational"
                  name={owner.nome}
                  avatarUrl={owner.avatar_url}
                  cargo={ownerCargo}
                  active={active}
                  onClick={() => toggleOwnerFilter(ownerKey)}
                  secondaryMetrics={[
                    {
                      id: 'recentes',
                      label: '0-2d',
                      value: formatNumber(owner.recentes),
                      tone: 'success',
                      icon: TimerReset,
                    },
                    {
                      id: 'atencao',
                      label: '3-6d',
                      value: formatNumber(owner.atencao),
                      tone: 'warning',
                      icon: Clock3,
                    },
                    {
                      id: 'atrasadas',
                      label: '7+d',
                      value: formatNumber(owner.atrasadas),
                      tone: 'danger',
                      icon: AlertTriangle,
                    },
                  ]}
                  summary={
                    <>
                      <span className="text-base font-bold text-foreground">{formatNumber(owner.total)}</span>
                      <span> de ordens ativas</span>
                    </>
                  }
                />
              )
            })}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {ownerGroups.map((group) => (
                <OrdersOwnerFullCard
                  key={group.id}
                  group={group}
                  canReassign={canReassign}
                  reassignTargets={reassignTargets}
                  selectedNotaIds={selectedNotaIdsSet}
                  onToggleRowSelection={(notaId) => {
                    setSelectedNotaIds((prev) => (prev.includes(notaId) ? prev.filter((id) => id !== notaId) : [...prev, notaId]))
                  }}
                />
              ))}
              {poolGroupsWithRows.map((group) => (
                <OrdersPoolCard key={group.pool_nome} group={group} />
              ))}
            </div>
            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={() => fetchWorkspace(false, nextCursor)} disabled={loadingMore}>
                  {loadingMore ? (
                    <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Carregando...</>
                  ) : (
                    `Carregar mais (${rows.length} carregadas)`
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {presentation.showWorkspaceToolbar && <div className="sticky top-2 z-30 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="grid gap-3 xl:grid-cols-12 xl:items-start">
          <Input
            ref={searchInputRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar por nota, ordem ou descrição"
            className="xl:col-span-3"
          />

          <div className={cn(periodControlsClassName, 'xl:col-span-5')}>
            <Select
              value={filters.periodMode}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  periodMode: value as OrdersPeriodModeOperational,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_MODE_LABELS.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filters.periodMode === 'year' && (
              <Select value={String(filters.year ?? years[0])} onValueChange={(value) => setFilters((prev) => ({ ...prev, year: Number(value) }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {filters.periodMode === 'year_month' && (
              <>
                <Select value={String(filters.year ?? years[0])} onValueChange={(value) => setFilters((prev) => ({ ...prev, year: Number(value) }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Ano" />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(filters.month ?? 1)} onValueChange={(value) => setFilters((prev) => ({ ...prev, month: Number(value) }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_LABELS.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {filters.periodMode === 'month' && (
              <Select value={String(filters.month ?? 1)} onValueChange={(value) => setFilters((prev) => ({ ...prev, month: Number(value) }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((month) => (
                    <SelectItem key={month.value} value={String(month.value)}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {filters.periodMode === 'range' && (
              <>
                <Select value={detectDatePreset(filters.startDate ?? null, filters.endDate ?? null)} onValueChange={handleDatePreset}>
                  <SelectTrigger>
                    <SelectValue placeholder="Período rápido" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={filters.startDate ?? ''}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      startDate: event.target.value || null,
                    }))
                  }
                />
                <Input
                  type="date"
                  value={filters.endDate ?? ''}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      endDate: event.target.value || null,
                    }))
                  }
                />
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:col-span-4 xl:justify-end">
            <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground">
              <input type="checkbox" checked={allLoadedSelected} onChange={toggleSelectAllLoaded} className="h-4 w-4" />
              Selecionar carregadas
            </label>
            <Button type="button" size="sm" className="justify-center" onClick={() => void handleCopyFilteredOrders()} disabled={copyFilterLoading || loadingInitial || rows.length === 0}>
              {copyFilterLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              {copyFilterLoading ? 'Copiando filtro...' : 'Copiar filtro'}
            </Button>
            <OperacionaisEmCampoDialog />
            <Button type="button" variant="outline" size="sm" onClick={() => { void exportOrdersToXlsx(rows) }} disabled={rows.length === 0}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Exportar planilha
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchWorkspace(true)}>
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Select value={filters.status || 'ativas'} onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.prioridade || 'todas'} onValueChange={(value) => setFilters((prev) => ({ ...prev, prioridade: value }))}>
            <SelectTrigger>
              <SelectValue placeholder="Prioridade" />
            </SelectTrigger>
            <SelectContent>
              {PRIORIDADE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentUser.canViewGlobal && (
            <Select value={filters.responsavel || 'todos'} onValueChange={(value) => setFilters((prev) => ({ ...prev, responsavel: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os responsáveis</SelectItem>
                {responsavelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <SearchableSelect
            id="workspace-unidades"
            options={unitSelectOptions}
            value={filters.unidade}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, unidade: value }))}
            placeholder="Unidade"
          />
        </div>
        {smartSearch.mode !== 'none' && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {smartSearch.mode === 'responsavel'
              ? `Busca inteligente ativa: responsável "${smartSearch.matchedOwnerLabel}".`
              : smartSearch.mode === 'ordem'
                ? 'Busca inteligente ativa: número longo priorizado como ORDEM.'
                : smartSearch.mode === 'nota'
                  ? 'Busca inteligente ativa: número curto priorizado como NOTA.'
                  : 'Busca inteligente ativa: texto em descrição e termos relacionados.'}
          </p>
        )}
      </div>}

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

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {presentation.showWorkspaceTable && <>
      <div ref={parentRef} className="h-[68vh] overflow-auto rounded-lg border">
        {loadingInitial ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando ordens...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Nenhuma ordem para os filtros aplicados.</div>
        ) : (
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index]
              const notaId = getRowNotaId(row)
              const selected = notaId ? selectedNotaIdsSet.has(notaId) : false

              return (
                <div key={row.ordem_id} className="absolute left-0 top-0 w-full px-3 py-2" style={{ transform: `translateY(${virtualRow.start}px)` }}>
                  <OrderCompactCard
                    row={row}
                    selected={selected}
                    showCheckbox
                    highlightQuery={smartSearch.highlightQuery}
                    onToggleSelection={toggleSelection}
                    showReassign={canReassign && reassignTargets.length > 0}
                    reassignProps={{
                      currentAdminId: row.responsavel_atual_id,
                      admins: reassignTargets,
                      skipRouterRefresh: true,
                      onReassigned: ({ notaId, novoAdminId }) => {
                        applyReassignResult([
                          {
                            nota_id: notaId,
                            administrador_destino_id: novoAdminId,
                          },
                        ])
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

      <div className="flex items-center justify-center text-xs text-muted-foreground py-1">
        {loadingMore ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Carregando mais ordens... ({rows.length} carregadas)
          </>
        ) : nextCursor ? (
          showManualLoadMore ? (
            <Button variant="outline" size="sm" onClick={() => fetchWorkspace(false, nextCursor)}>
              Carregar mais ({rows.length} carregadas)
            </Button>
          ) : (
            <span>{rows.length} ordens carregadas — role para ver mais</span>
          )
        ) : rows.length > 0 ? (
          <span>{rows.length} ordens carregadas</span>
        ) : null}
      </div>

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
      </>}
    </div>
  )
}
