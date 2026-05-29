'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2 } from 'lucide-react'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import { OrdersDetailDrawer } from '@/components/orders/orders-detail-drawer'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersPendingSyncSection } from '@/components/orders/orders-pending-sync-section'
import { resolveOrdersWorkspacePresentation } from '@/components/orders/orders-workspace-presentation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getOrdersCriticalityLevel, getRawStatusLabel, getSemaforoLabel, workspaceKpisToOrdemNotaKpis } from '@/lib/orders/metrics'
import { prefetchOrderDetailQuery } from '@/lib/orders/detail-query'
import { UNASSIGNED_ORDER_OWNER_KEY, buildVisibleOwnerSummary, hasIndividualOwnerSelection, toOrderOwnerKey } from '@/lib/orders/owner-visibility'
import { shouldHideOwnerOutsidePmpl } from '@/lib/admin/admin-identity-catalog'
import { buildCopyPayload, copyToClipboard } from '@/lib/orders/copy'
import { isPrivateOwnerLookupActive as hasPrivateOwnerLookup } from '@/lib/orders/private-owner-lookup'
import { getSelectedOrderCodes, mergeKnownOrderCodes, toggleSelectedNotaIds, toggleVisibleNotaIds } from '@/lib/orders/selection'
import { isRawOrderActive } from '@/lib/orders/status-raw'
import { fetchAllFilteredOrderCodes } from '@/lib/orders/workspace-copy'
import { useOrdersFilters, sanitizeText } from '@/components/orders/use-orders-filters'
import { useOrdersData } from '@/components/orders/use-orders-data'
import { OrdersWorkspaceFiltersBar } from '@/components/orders/orders-workspace-filters-bar'
import { OrdersWorkspaceHighlightsPanel } from '@/components/orders/orders-workspace-highlights-panel'
import { OrdersWorkspaceOwnerCards } from '@/components/orders/orders-workspace-owner-cards'
import { SupplierOrderLocator } from '@/components/orders/supplier-order-locator'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  Especialidade,
  OrderOwnerGroup,
  OrdersPoolGroup,
  PanelViewMode,
  OrdersWorkspaceFilters,
  OrdemNotaAcompanhamento,
  UserRole,
} from '@/lib/types/database'

interface OrdersWorkspaceProps {
  initialFilters: OrdersWorkspaceFilters
  initialUser: {
    role: UserRole
    actualRole: UserRole
    adminId: string
    canViewGlobal: boolean
    canAccessPmpl: boolean
    maintainerViewActive?: boolean
    userEmail: string
    canUseDeveloperViewSwitcher: boolean
  }
}


const OWNER_CARDS_VIEW_MODE_STORAGE_KEY = 'cockpit:ordens:owner-cards:view-mode'
const AUTO_LOAD_MAX_ROWS = 300


function formatIsoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR')
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


function normalizeNotaId(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function getRowNotaId(row: OrdemNotaAcompanhamento): string | null {
  return normalizeNotaId(row.nota_id)
}

export function OrdersWorkspace({ initialFilters, initialUser }: OrdersWorkspaceProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selectedNotaIds, setSelectedNotaIds] = useState<string[]>([])
  const [lastSelectedNotaId, setLastSelectedNotaId] = useState<string | null>(null)
  const [knownOrderCodesByNotaId, setKnownOrderCodesByNotaId] = useState<Record<string, string>>({})
  const [detailRow, setDetailRow] = useState<OrdemNotaAcompanhamento | null>(null)
  const [ownerCardsViewMode, setOwnerCardsViewMode] = useState<PanelViewMode>(
    () => resolveOrdersWorkspacePresentation(initialUser.role).defaultOwnerCardsViewMode
  )
  const [copyFilterLoading, setCopyFilterLoading] = useState(false)
  const [pendingReassignNotaIds, setPendingReassignNotaIds] = useState<Set<string>>(new Set())

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
      if (pendingSearchEnterActionRef.current) {
        pendingSearchEnterActionRef.current = false
        await copyFromRow(resetRows[0])
      }
    },
    [copyFromRow, pendingSearchEnterActionRef],
  )

  // --- Data + smart search ---
  const {
    rows, pendingSyncRows, unitOptions: fetchedUnitOptions, kpis, ownerSummary, reassignTargets, poolGroups, poolCentros, highlights,
    isLoadingHighlights, isFetchingHighlights, nextCursor, isFetching, loadingInitial, loadingMore, error, currentUser, parentRef, smartSearch, effectiveFilters, fetchWorkspace,
    applyOptimisticReassignments,
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
  const privateOwnerLookupActive = isPrivateScope && hasPrivateOwnerLookup(effectiveFilters.q)
  const developerViewActive = currentUser.maintainerViewActive === true
  const rowOrderCodeEntries = useMemo(
    () =>
      rows.map((row) => ({
        notaId: getRowNotaId(row),
        orderCode: row.ordem_codigo,
      })),
    [rows],
  )

  // Guard: reset tipoOrdem when user loses PMPL access (bridges data + filter hooks)
  useEffect(() => {
    if (currentUser.canAccessPmpl) return
    if (filters.tipoOrdem !== 'PMPL') return
    setFilters((prev) => ({ ...prev, tipoOrdem: 'PMOS' }))
  }, [currentUser.canAccessPmpl, filters.tipoOrdem, setFilters])

  useEffect(() => {
    setKnownOrderCodesByNotaId((prev) => mergeKnownOrderCodes(prev, rowOrderCodeEntries))
  }, [rowOrderCodeEntries])

  const handleDeveloperViewChange = useCallback(async (value: string) => {
    if (value === 'real') {
      await fetch('/api/maintainer/elevate', { method: 'DELETE' })
    } else {
      await fetch('/api/maintainer/elevate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: value }),
      })
    }
    router.refresh()
  }, [router])

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
  const orderCodesByNotaId = useMemo(
    () => mergeKnownOrderCodes(knownOrderCodesByNotaId, rowOrderCodeEntries),
    [knownOrderCodesByNotaId, rowOrderCodeEntries],
  )
  const selectedOrderCodes = useMemo(
    () => getSelectedOrderCodes(selectedNotaIds, orderCodesByNotaId),
    [selectedNotaIds, orderCodesByNotaId],
  )
  const copyUsesSelection = selectedNotaIds.length > 0
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

  function toggleSelection(notaId: string, shiftKey = false) {
    const normalizedNotaId = normalizeNotaId(notaId)
    if (!normalizedNotaId) return

    if (shiftKey && lastSelectedNotaId) {
      const visibleNotaIds = rowsWithLinkedNote
        .map((row) => getRowNotaId(row))
        .filter((id): id is string => Boolean(id))

      const startIdx = visibleNotaIds.indexOf(lastSelectedNotaId)
      const endIdx = visibleNotaIds.indexOf(normalizedNotaId)

      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        const rangeIds = visibleNotaIds.slice(from, to + 1)
        setSelectedNotaIds((prev) => Array.from(new Set([...prev, ...rangeIds])))
        setLastSelectedNotaId(normalizedNotaId)
        return
      }
    }

    setSelectedNotaIds((prev) => toggleSelectedNotaIds(prev, normalizedNotaId))
    setLastSelectedNotaId(normalizedNotaId)
  }

  function toggleSelectAllLoaded() {
    setSelectedNotaIds((prev) => {
      const visibleNotaIds = rowsWithLinkedNote.map((row) => getRowNotaId(row)).filter(Boolean) as string[]
      return toggleVisibleNotaIds(prev, visibleNotaIds, allLoadedSelected)
    })
  }

  const prefetchOrderDetail = useCallback(
    (row: OrdemNotaAcompanhamento) => {
      void prefetchOrderDetailQuery(queryClient, {
        ordemId: row.ordem_id ?? null,
        notaId: getRowNotaId(row),
        lookupQuery: privateOwnerLookupActive ? effectiveFilters.q : null,
      })
    },
    [effectiveFilters.q, privateOwnerLookupActive, queryClient],
  )

  function applyReassignResult(assignments: Array<{ nota_id: string; administrador_destino_id: string }>) {
    if (assignments.length === 0) return

    // Marca essas notas como pending por ~600ms pra dar feedback visual
    const newPending = new Set(assignments.map((a) => a.nota_id).filter(Boolean) as string[])
    setPendingReassignNotaIds((prev) => new Set([...prev, ...newPending]))
    setTimeout(() => {
      setPendingReassignNotaIds((prev) => {
        const next = new Set(prev)
        for (const id of newPending) next.delete(id)
        return next
      })
    }, 600)

    applyOptimisticReassignments(assignments)

    const assignByNota = new Map(
      assignments
        .map((item) => {
          const notaId = normalizeNotaId(item.nota_id)
          return notaId ? ([notaId, item.administrador_destino_id] as const) : null
        })
        .filter(Boolean) as Array<readonly [string, string]>,
    )

    setDetailRow((prev) => {
      if (!prev) return prev
      const notaId = getRowNotaId(prev)
      if (!notaId) return prev

      const destino = assignByNota.get(notaId)
      if (!destino) return prev

      return {
        ...prev,
        responsavel_atual_id: destino,
        responsavel_atual_nome: ownerById.get(destino) ?? prev.responsavel_atual_nome,
      }
    })

    setSelectedNotaIds([])
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
  const copyButtonLabel = useMemo(() => {
    if (!copyUsesSelection) {
      return copyFilterLoading ? 'Copiando filtro...' : 'Copiar filtro'
    }

    if (copyFilterLoading) {
      return selectedNotaIds.length === 1 ? 'Copiando 1 ordem...' : `Copiando ${selectedNotaIds.length} ordens...`
    }

    return selectedNotaIds.length === 1 ? 'Copiar 1 ordem' : `Copiar ${selectedNotaIds.length} ordens`
  }, [copyFilterLoading, copyUsesSelection, selectedNotaIds.length])

  const handleCopyOrders = useCallback(async () => {
    const copyingSelectedOrders = selectedNotaIds.length > 0
    setCopyFilterLoading(true)

    try {
      const codes = copyingSelectedOrders
        ? selectedOrderCodes
        : (await fetchAllFilteredOrderCodes(effectiveFilters)).codes
      const payload = buildCopyPayload(codes)

      if (!payload) {
        toast({
          title: copyingSelectedOrders ? 'Nenhuma ordem marcada para copiar' : 'Nenhuma ordem para copiar',
          description: copyingSelectedOrders
            ? 'As ordens marcadas ainda não possuem código copiável.'
            : 'Nenhuma ordem do filtro atual possui código copiável.',
          variant: 'info',
        })
        return
      }

      const copied = await copyToClipboard(payload)
      if (!copied) {
        toast({
          title: copyingSelectedOrders ? 'Falha ao copiar selecionadas' : 'Falha ao copiar filtro',
          description: 'Não foi possível copiar para a área de transferência.',
          variant: 'error',
        })
        return
      }

      toast({
        title: copyingSelectedOrders ? 'Ordens selecionadas copiadas' : 'Ordens do filtro copiadas',
        description: `${payload.split('\n').length} ordens prontas para colar no SAP.`,
        variant: 'success',
      })
    } catch (error) {
      toast({
        title: copyingSelectedOrders ? 'Falha ao copiar selecionadas' : 'Falha ao copiar filtro',
        description: error instanceof Error
          ? error.message
          : copyingSelectedOrders
            ? 'Não foi possível preparar as ordens selecionadas.'
            : 'Não foi possível carregar as ordens do filtro atual.',
        variant: 'error',
      })
    } finally {
      setCopyFilterLoading(false)
    }
  }, [effectiveFilters, selectedNotaIds.length, selectedOrderCodes, toast])

  const visibleOwners = useMemo(() => {
    const owners = buildVisibleOwnerSummary({
      ownerSummary,
      canViewGlobal: currentUser.canViewGlobal,
      isPrivateScope,
      currentAdminId: currentUser.adminId,
      tipoOrdem: filters.tipoOrdem,
      responsavel: filters.responsavel,
      hasScopedFilters: hasListScopeFilters,
    })
    return presentation.isViewerMode ? owners.filter((o) => o.administrador_id !== null) : owners
  }, [ownerSummary, filters.tipoOrdem, filters.responsavel, currentUser.canViewGlobal, currentUser.adminId, isPrivateScope, hasListScopeFilters, presentation.isViewerMode])

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
      {currentUser.canUseDeveloperViewSwitcher && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Modo dev de visualizacao</p>
            <p className="text-xs text-muted-foreground">
              Perfil real: {currentUser.actualRole}. A simulacao muda a leitura da tela, mas acoes que alteram dados continuam validando sua permissao real.
            </p>
          </div>

          <Select value={developerViewActive ? currentUser.role : 'real'} onValueChange={handleDeveloperViewChange}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Simular perfil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="real">Usar perfil real</SelectItem>
              <SelectItem value="admin">Simular admin</SelectItem>
              <SelectItem value="gestor">Simular gestor</SelectItem>
              <SelectItem value="viewer">Simular viewer</SelectItem>
            </SelectContent>
          </Select>

          {developerViewActive && (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              Simulando: {currentUser.role}
            </span>
          )}
        </div>
      )}

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

      {!presentation.isViewerMode && hasListScopeFilters && !privateOwnerLookupActive && (
        <p className="text-xs text-muted-foreground">
          Os KPIs acima mostram o total canônico do período e do tipo de ordem selecionado. Os filtros abaixo afetam a carteira, a listagem e a distribuição por colaborador.
        </p>
      )}

      {privateOwnerLookupActive && (
        <p className="text-xs text-muted-foreground">
          Busca pontual ativa: administradores conseguem localizar quem esta com a ordem ou nota pesquisada sem abrir a carteira completa dos outros.
        </p>
      )}

      {!presentation.isViewerMode && (
        <div className="flex items-center justify-end">
          <SupplierOrderLocator
            currentAdminId={currentUser.adminId}
            canReassign={canReassign}
            reassignTargets={reassignTargets}
            onReassigned={({ notaId, novoAdminId }) => {
              applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
            }}
          />
        </div>
      )}

      {!presentation.isViewerMode && !privateOwnerLookupActive && (
        <OrdersPendingSyncSection
          rows={pendingSyncRows}
          highlightQuery={smartSearch.highlightQuery}
          canReassign={canReassign}
          reassignTargets={reassignTargets}
          onOpenDetails={setDetailRow}
          onPrefetchDetails={prefetchOrderDetail}
          onReassigned={({ notaId, novoAdminId }) => {
            applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])
          }}
          collapsible={currentUser.role === 'gestor' && currentUser.canViewGlobal}
          defaultCollapsed={currentUser.role === 'gestor' && currentUser.canViewGlobal}
        />
      )}

      {presentation.showPriorityLanes && !privateOwnerLookupActive && (
        <OrdersWorkspaceHighlightsPanel
          highlights={highlights}
          isLoading={isLoadingHighlights}
          isFetching={isFetchingHighlights}
          priorityTotals={priorityTotals}
          highlightQuery={smartSearch.highlightQuery}
          canReassign={canReassign}
          reassignTargets={reassignTargets}
          onFilterOldest={() => setFilters((prev) => ({ ...prev, status: 'ativas', prioridade: 'vermelho' }))}
          onFilterAttention={() => setFilters((prev) => ({ ...prev, status: 'ativas', prioridade: 'amarelo' }))}
          onOpenDetails={setDetailRow}
          onPrefetchDetails={prefetchOrderDetail}
          onReassigned={({ notaId, novoAdminId }) => applyReassignResult([{ nota_id: notaId, administrador_destino_id: novoAdminId }])}
        />
      )}

      {!privateOwnerLookupActive && (
        <OrdersWorkspaceOwnerCards
          viewMode={ownerCardsViewMode}
          showOwnerToolbar={presentation.showOwnerToolbar}
          isViewerMode={presentation.isViewerMode}
          canViewGlobal={currentUser.canViewGlobal}
          semResponsavel={kpis.sem_responsavel}
          visibleOwners={visibleOwners}
          activeResponsavel={filters.responsavel}
          isPrivateScope={isPrivateScope}
          ownerEspecialidadeById={ownerEspecialidadeById}
          ownerGroups={ownerGroups}
          poolGroupsWithRows={poolGroupsWithRows}
          canReassign={canReassign}
          reassignTargets={reassignTargets}
          selectedNotaIds={selectedNotaIdsSet}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          rowsCount={rows.length}
          onViewModeChange={handleOwnerCardsViewModeChange}
          onFilterUnassigned={() => setFilters((prev) => ({ ...prev, responsavel: UNASSIGNED_ORDER_OWNER_KEY }))}
          onFilterAll={() => setFilters((prev) => ({ ...prev, responsavel: 'todos' }))}
          onToggleOwner={toggleOwnerFilter}
          onToggleSelection={toggleSelection}
          onLoadMore={() => fetchWorkspace(false, nextCursor)}
        />
      )}

      {presentation.showWorkspaceToolbar && (
        <OrdersWorkspaceFiltersBar
          filters={filters}
          setFilters={setFilters}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          searchInputRef={searchInputRef}
          onSearchKeyDown={handleSearchKeyDown}
          allLoadedSelected={allLoadedSelected}
          onToggleSelectAllLoaded={toggleSelectAllLoaded}
          copyFilterLoading={copyFilterLoading}
          copyButtonLabel={copyButtonLabel}
          onCopyOrders={handleCopyOrders}
          copyUsesSelection={copyUsesSelection}
          loadingInitial={loadingInitial}
          rowsCount={rows.length}
          responsavelOptions={responsavelOptions}
          unitSelectOptions={unitSelectOptions}
          smartSearch={smartSearch}
          canViewGlobal={currentUser.canViewGlobal}
          onExport={() => void exportOrdersToXlsx(rows)}
          onRefresh={() => fetchWorkspace(true)}
        />
      )}

      {isFetching && !loadingInitial && (
        <p className="text-xs text-muted-foreground">Atualizando...</p>
      )}

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
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-md" />
            ))}
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
                    isLoading={notaId ? pendingReassignNotaIds.has(notaId) : false}
                    showCheckbox={canReassign}
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
                    onPrefetchDetails={() => prefetchOrderDetail(row)}
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
        lookupQuery={privateOwnerLookupActive ? effectiveFilters.q : null}
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
