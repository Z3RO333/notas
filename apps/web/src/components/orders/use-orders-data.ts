import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { buildWorkspaceParams } from '@/lib/orders/workspace-query'
import { createOrdersWorkspaceQueryKeys } from '@/lib/orders/workspace-query-keys'
import { ORDER_DETAIL_QUERY_NAMESPACE } from '@/lib/orders/detail-query'
import { UNASSIGNED_ORDER_OWNER_KEY } from '@/lib/orders/owner-visibility'
import { isRawOrderActive, isRawOrderEmAberto } from '@/lib/orders/status-raw'
import { sanitizeText } from '@/components/orders/use-orders-filters'
import type {
  OrderDetailDrawerData,
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
  OrdersOwnerSummary,
  OrdersPoolGroup,
  OrdersWorkspaceCursor,
  OrdersWorkspaceFilters,
  OrdersWorkspaceHighlights,
  OrdersWorkspaceKpis,
  OrdersWorkspaceResponse,
  UserRole,
} from '@/lib/types/database'

const BATCH_SIZE = 100

const INITIAL_KPIS: OrdersWorkspaceKpis = {
  total: 0,
  abertas: 0,
  em_tratativa: 0,
  em_avaliacao: 0,
  concluidas: 0,
  canceladas: 0,
  avaliadas: 0,
  atrasadas: 0,
  sem_responsavel: 0,
}

const INITIAL_HIGHLIGHTS: OrdersWorkspaceHighlights = {
  oldest: [],
  attention: [],
}

export function mergeRows(
  prev: OrdemNotaAcompanhamento[],
  incoming: OrdemNotaAcompanhamento[],
): OrdemNotaAcompanhamento[] {
  if (prev.length === 0) return incoming
  const existingIds = new Set(prev.map((row) => row.ordem_id))
  const newRows = incoming.filter((row) => !existingIds.has(row.ordem_id))
  return newRows.length === 0 ? prev : [...prev, ...newRows]
}

function normalizeNotaId(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function getRowNotaId(row: Pick<OrdemNotaAcompanhamento, 'nota_id'>): string | null {
  return normalizeNotaId(row.nota_id)
}

function matchesResponsavelScope(
  responsavelFilter: string,
  responsavelAtualId: string | null,
): boolean {
  const scope = responsavelFilter.trim()
  if (!scope || scope === 'todos') return true
  if (scope === UNASSIGNED_ORDER_OWNER_KEY) return responsavelAtualId === null
  return responsavelAtualId === scope
}

function patchAssignedRows(
  currentRows: OrdemNotaAcompanhamento[],
  assignByNota: Map<string, string>,
  reassignTargetById: Map<string, OrderReassignTarget>,
  responsavelFilter: string,
): OrdemNotaAcompanhamento[] {
  return currentRows
    .map((row) => {
      const notaId = getRowNotaId(row)
      if (!notaId) return row

      const destino = assignByNota.get(notaId)
      if (!destino) return row

      return {
        ...row,
        responsavel_atual_id: destino,
        responsavel_atual_nome: reassignTargetById.get(destino)?.nome ?? row.responsavel_atual_nome,
      }
    })
    .filter((row) => matchesResponsavelScope(responsavelFilter, row.responsavel_atual_id))
}

function sortOwnerSummary(items: OrdersOwnerSummary[]): OrdersOwnerSummary[] {
  return [...items].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

function patchOwnerSummaryCounters(
  item: OrdersOwnerSummary,
  row: OrdemNotaAcompanhamento,
  delta: number,
): OrdersOwnerSummary {
  if (!isRawOrderActive(row.status_ordem_raw)) return item

  const next = {
    ...item,
    total: Math.max(0, item.total + delta),
    abertas: Math.max(0, item.abertas + (isRawOrderEmAberto(row.status_ordem_raw) ? delta : 0)),
  }

  if (row.semaforo_atraso === 'verde') {
    next.recentes = Math.max(0, item.recentes + delta)
  } else if (row.semaforo_atraso === 'amarelo') {
    next.atencao = Math.max(0, item.atencao + delta)
  } else if (row.semaforo_atraso === 'vermelho') {
    next.atrasadas = Math.max(0, item.atrasadas + delta)
  }

  return next
}

function patchOwnerSummaryForAssignment(
  currentSummary: OrdersOwnerSummary[],
  row: OrdemNotaAcompanhamento,
  destinoId: string,
  reassignTargetById: Map<string, OrderReassignTarget>,
  responsavelFilter: string,
): OrdersOwnerSummary[] {
  if (!isRawOrderActive(row.status_ordem_raw)) return currentSummary

  const previousOwnerId = row.responsavel_atual_id
  const nextSummary = [...currentSummary]
  const shouldTrackPreviousOwner = matchesResponsavelScope(responsavelFilter, previousOwnerId)
  const shouldTrackDestino = matchesResponsavelScope(responsavelFilter, destinoId)

  if (shouldTrackPreviousOwner) {
    const previousIndex = nextSummary.findIndex((item) => item.administrador_id === previousOwnerId)
    if (previousIndex >= 0) {
      nextSummary[previousIndex] = patchOwnerSummaryCounters(nextSummary[previousIndex], row, -1)
    }
  }

  if (shouldTrackDestino) {
    const destinoIndex = nextSummary.findIndex((item) => item.administrador_id === destinoId)
    if (destinoIndex >= 0) {
      nextSummary[destinoIndex] = patchOwnerSummaryCounters(nextSummary[destinoIndex], row, 1)
    } else {
      const destino = reassignTargetById.get(destinoId)
      nextSummary.push(patchOwnerSummaryCounters({
        administrador_id: destinoId,
        nome: destino?.nome ?? 'Sem nome',
        avatar_url: destino?.avatar_url ?? null,
        total: 0,
        abertas: 0,
        recentes: 0,
        atencao: 0,
        atrasadas: 0,
      }, row, 1))
    }
  }

  return sortOwnerSummary(nextSummary)
}

function patchPoolGroupsForAssignment(
  currentGroups: Array<Omit<OrdersPoolGroup, 'rows'>>,
  row: OrdemNotaAcompanhamento,
  poolCentros: Record<string, string>,
): Array<Omit<OrdersPoolGroup, 'rows'>> {
  if (!isRawOrderActive(row.status_ordem_raw)) return currentGroups
  if (row.responsavel_atual_id !== null || !row.centro) return currentGroups

  const poolNome = poolCentros[row.centro]
  if (!poolNome) return currentGroups

  return currentGroups.map((group) => {
    if (group.pool_nome !== poolNome) return group

    return {
      ...group,
      total: Math.max(0, group.total - 1),
      abertas: Math.max(0, group.abertas - (isRawOrderEmAberto(row.status_ordem_raw) ? 1 : 0)),
      atencao: Math.max(0, group.atencao - (row.semaforo_atraso === 'amarelo' ? 1 : 0)),
      atrasadas: Math.max(0, group.atrasadas - (row.semaforo_atraso === 'vermelho' ? 1 : 0)),
    }
  })
}

// --- Smart search ---

function normalizeSearchToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function isNumericSearchToken(value: string): boolean {
  return /^\d+$/.test(value)
}

export type SmartSearchMode = 'none' | 'ordem' | 'nota' | 'texto' | 'responsavel'

export interface SmartSearchResolution {
  mode: SmartSearchMode
  effectiveQ: string
  derivedResponsavel: string | null
  highlightQuery: string
  matchedOwnerLabel: string | null
}

export function resolveSmartSearch(
  query: string,
  ownerCandidates: Array<{ id: string; nome: string }>,
  currentResponsavel: string,
  canViewGlobal: boolean,
): SmartSearchResolution {
  const clean = sanitizeText(query)
  if (!clean) {
    return { mode: 'none', effectiveQ: '', derivedResponsavel: null, highlightQuery: '', matchedOwnerLabel: null }
  }

  if (isNumericSearchToken(clean)) {
    return {
      mode: clean.length <= 7 ? 'nota' : 'ordem',
      effectiveQ: clean,
      derivedResponsavel: null,
      highlightQuery: clean,
      matchedOwnerLabel: null,
    }
  }

  const normalized = normalizeSearchToken(clean)
  if (canViewGlobal && (currentResponsavel === 'todos' || !currentResponsavel) && normalized.length >= 3) {
    const matches = ownerCandidates.filter(
      (owner) => Boolean(owner?.id) && Boolean(owner?.nome) && normalizeSearchToken(owner.nome).includes(normalized),
    )
    if (matches.length === 1) {
      return {
        mode: 'responsavel',
        effectiveQ: '',
        derivedResponsavel: matches[0].id,
        highlightQuery: clean,
        matchedOwnerLabel: matches[0].nome,
      }
    }
  }

  return { mode: 'texto', effectiveQ: clean, derivedResponsavel: null, highlightQuery: clean, matchedOwnerLabel: null }
}

// --- Hook ---

export interface OrdersDataUser {
  role: UserRole
  actualRole: UserRole
  adminId: string
  canViewGlobal: boolean
  canAccessPmpl: boolean
  maintainerViewActive?: boolean
  userEmail: string
  canUseDeveloperViewSwitcher: boolean
}

interface UseOrdersDataOptions {
  filters: OrdersWorkspaceFilters
  initialUser: OrdersDataUser
  /** Called after a successful reset fetch — caller handles selection clearing and enter-search UX */
  onResetSuccess: (rows: OrdemNotaAcompanhamento[]) => Promise<void>
}

export function useOrdersData({ filters, initialUser, onResetSuccess }: UseOrdersDataOptions) {
  const queryClient = useQueryClient()

  const [rows, setRows] = useState<OrdemNotaAcompanhamento[]>([])
  const [pendingSyncRows, setPendingSyncRows] = useState<OrdemNotaAcompanhamento[]>([])
  const [kpis, setKpis] = useState<OrdersWorkspaceKpis>(INITIAL_KPIS)
  const [ownerSummary, setOwnerSummary] = useState<OrdersOwnerSummary[]>([])
  const [poolGroups, setPoolGroups] = useState<Array<Omit<OrdersPoolGroup, 'rows'>>>([])
  const [nextCursor, setNextCursor] = useState<OrdersWorkspaceCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<OrdersDataUser>(initialUser)
  const [reassignTargets, setReassignTargets] = useState<OrderReassignTarget[]>([])

  const parentRef = useRef<HTMLDivElement | null>(null)

  const searchOwnerCandidates = useMemo(
    () =>
      reassignTargets
        .filter((t): t is OrderReassignTarget => Boolean(t?.id) && Boolean(t?.nome))
        .map((t) => ({ id: t.id, nome: t.nome })),
    [reassignTargets],
  )
  const reassignTargetById = useMemo(
    () => new Map(reassignTargets.map((target) => [target.id, target] as const)),
    [reassignTargets],
  )

  const smartSearch = useMemo(
    () => resolveSmartSearch(filters.q, searchOwnerCandidates, filters.responsavel, currentUser.canViewGlobal),
    [filters.q, searchOwnerCandidates, filters.responsavel, currentUser.canViewGlobal],
  )

  const effectiveFilters = useMemo<OrdersWorkspaceFilters>(
    () => ({
      ...filters,
      q: smartSearch.effectiveQ,
      responsavel: smartSearch.derivedResponsavel ?? filters.responsavel,
    }),
    [filters, smartSearch.effectiveQ, smartSearch.derivedResponsavel],
  )

  const workspaceQueryKeys = useMemo(
    () => createOrdersWorkspaceQueryKeys(effectiveFilters),
    [effectiveFilters],
  )

  // Main query: page 0, uses skip_highlights for faster response
  const {
    data: freshData,
    isPlaceholderData,
    isFetching,
    error: queryError,
  } = useQuery({
    queryKey: workspaceQueryKeys.main,
    queryFn: async ({ signal }) => {
      const params = buildWorkspaceParams(effectiveFilters, null, BATCH_SIZE)
      params.set('skip_highlights', '1')
      const res = await fetch(`/api/ordens/workspace?${params.toString()}`, {
        signal,
        cache: 'no-store',
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar ordens')
      }
      return res.json() as Promise<OrdersWorkspaceResponse>
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  // Highlights query: runs in parallel, deferred display
  const {
    data: highlightsData,
    isLoading: isLoadingHighlights,
    isFetching: isFetchingHighlights,
  } = useQuery({
    queryKey: workspaceQueryKeys.highlights,
    queryFn: async ({ signal }) => {
      const params = buildWorkspaceParams(effectiveFilters, null, BATCH_SIZE)
      params.set('highlights_only', '1')
      const res = await fetch(`/api/ordens/workspace?${params.toString()}`, {
        signal,
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Falha ao carregar destaques')
      return res.json() as Promise<{ highlights: OrdersWorkspaceHighlights }>
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  // Effect 1: filter change → scroll to top + reset pagination state
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 })
    setNextCursor(null)
    setLoadMoreError(null)
  }, [workspaceQueryKeys.scopeKey])

  // Effect 2: fresh (non-placeholder) data arrived → sync all state + notify caller
  useEffect(() => {
    if (!freshData || isPlaceholderData) return

    setRows(freshData.rows)
    setPendingSyncRows(freshData.pendingSyncRows ?? [])
    setKpis(freshData.kpis ?? INITIAL_KPIS)
    setOwnerSummary(freshData.ownerSummary ?? [])
    setPoolGroups((freshData.poolGroups ?? []) as Array<Omit<OrdersPoolGroup, 'rows'>>)
    setNextCursor(freshData.nextCursor)
    setReassignTargets(freshData.reassignTargets)
    setCurrentUser((prev) => ({
      ...freshData.currentUser,
      userEmail: prev.userEmail,
      actualRole: prev.actualRole,
      canUseDeveloperViewSwitcher: prev.canUseDeveloperViewSwitcher,
    }))

    void onResetSuccess(freshData.rows)
  }, [freshData, isPlaceholderData, onResetSuccess])

  // Load more pages (cursor-based pagination)
  const loadMore = useCallback(
    async (cursor: OrdersWorkspaceCursor) => {
      if (loadingMore) return
      setLoadingMore(true)
      try {
        const params = buildWorkspaceParams(effectiveFilters, cursor, BATCH_SIZE)
        params.set('skip_highlights', '1')
        const res = await fetch(`/api/ordens/workspace?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error || 'Falha ao carregar mais ordens')
        }
        const payload = (await res.json()) as OrdersWorkspaceResponse
        setRows((prev) => mergeRows(prev, payload.rows))
        setNextCursor(payload.nextCursor)
      } catch (err) {
        setLoadMoreError(err instanceof Error ? err.message : 'Falha ao carregar mais ordens')
      } finally {
        setLoadingMore(false)
      }
    },
    [effectiveFilters, loadingMore],
  )

  const applyOptimisticReassignments = useCallback(
    (assignments: Array<{ nota_id: string; administrador_destino_id: string }>) => {
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

      const loadedRowNotaIds = new Set(
        rows
          .map((row) => getRowNotaId(row))
          .filter((notaId): notaId is string => notaId !== null),
      )
      const highlightRows = [
        ...(highlightsData?.highlights.oldest ?? []),
        ...(highlightsData?.highlights.attention ?? []),
      ]
      const highlightRowNotaIds = new Set(
        highlightRows
          .map((row) => getRowNotaId(row))
          .filter((notaId): notaId is string => notaId !== null),
      )
      const sourceRowByNota = new Map<string, OrdemNotaAcompanhamento>()
      for (const row of [...rows, ...pendingSyncRows, ...highlightRows]) {
        const notaId = getRowNotaId(row)
        if (!notaId || sourceRowByNota.has(notaId)) continue
        sourceRowByNota.set(notaId, row)
      }

      const updatedRows = patchAssignedRows(rows, assignByNota, reassignTargetById, effectiveFilters.responsavel)
      const updatedPendingSyncRows = patchAssignedRows(
        pendingSyncRows,
        assignByNota,
        reassignTargetById,
        effectiveFilters.responsavel,
      )
      const updatedHighlights: OrdersWorkspaceHighlights = {
        oldest: patchAssignedRows(
          highlightsData?.highlights.oldest ?? [],
          assignByNota,
          reassignTargetById,
          effectiveFilters.responsavel,
        ),
        attention: patchAssignedRows(
          highlightsData?.highlights.attention ?? [],
          assignByNota,
          reassignTargetById,
          effectiveFilters.responsavel,
        ),
      }

      let nextKpis = kpis
      let nextOwnerSummary = ownerSummary
      let nextPoolGroups = poolGroups

      for (const [notaId, destinoId] of assignByNota) {
        const sourceRow = sourceRowByNota.get(notaId)
        if (!sourceRow) continue

        const isOfficialWorkspaceRow = loadedRowNotaIds.has(notaId) || highlightRowNotaIds.has(notaId)
        if (!isOfficialWorkspaceRow) continue

        if (sourceRow.responsavel_atual_id === null && isRawOrderActive(sourceRow.status_ordem_raw)) {
          nextKpis = {
            ...nextKpis,
            sem_responsavel: Math.max(0, nextKpis.sem_responsavel - 1),
          }
          nextPoolGroups = patchPoolGroupsForAssignment(nextPoolGroups, sourceRow, freshData?.poolCentros ?? {})
        }

        nextOwnerSummary = patchOwnerSummaryForAssignment(
          nextOwnerSummary,
          sourceRow,
          destinoId,
          reassignTargetById,
          effectiveFilters.responsavel,
        )
      }

      setRows(updatedRows)
      setPendingSyncRows(updatedPendingSyncRows)
      setKpis(nextKpis)
      setOwnerSummary(nextOwnerSummary)
      setPoolGroups(nextPoolGroups)

      queryClient.setQueryData<OrdersWorkspaceResponse>(workspaceQueryKeys.main, (old) => {
        if (!old) return old
        return {
          ...old,
          rows: updatedRows,
          pendingSyncRows: updatedPendingSyncRows,
          kpis: nextKpis,
          ownerSummary: nextOwnerSummary,
          poolGroups: nextPoolGroups,
        }
      })
      queryClient.setQueryData<{ highlights: OrdersWorkspaceHighlights }>(workspaceQueryKeys.highlights, (old) => {
        if (!old) return old
        return {
          ...old,
          highlights: updatedHighlights,
        }
      })
      queryClient.setQueriesData<OrderDetailDrawerData | undefined>(
        { queryKey: [ORDER_DETAIL_QUERY_NAMESPACE] },
        (old) => {
          if (!old) return old

          const notaId = getRowNotaId(old.ordem)
          if (!notaId) return old

          const destinoId = assignByNota.get(notaId)
          if (!destinoId) return old

          return {
            ...old,
            ordem: {
              ...old.ordem,
              responsavel_atual_id: destinoId,
              responsavel_atual_nome: reassignTargetById.get(destinoId)?.nome ?? old.ordem.responsavel_atual_nome,
            },
          }
        },
      )

      void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.highlights, exact: true })
    },
    [
      effectiveFilters.responsavel,
      freshData?.poolCentros,
      highlightsData?.highlights.attention,
      highlightsData?.highlights.oldest,
      kpis,
      ownerSummary,
      pendingSyncRows,
      poolGroups,
      queryClient,
      reassignTargetById,
      rows,
      workspaceQueryKeys.highlights,
      workspaceQueryKeys.main,
    ],
  )

  const invalidateWorkspace = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.main, exact: true })
    void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.highlights, exact: true })
  }, [queryClient, workspaceQueryKeys.highlights, workspaceQueryKeys.main])

  // Backward-compatible fetchWorkspace: reset triggers invalidation, paginate triggers loadMore
  const fetchWorkspace = useCallback(
    (reset: boolean, cursor?: OrdersWorkspaceCursor | null) => {
      if (reset) {
        invalidateWorkspace()
      } else if (cursor) {
        void loadMore(cursor)
      }
    },
    [invalidateWorkspace, loadMore],
  )

  const loadingInitial = isFetching && !isPlaceholderData && rows.length === 0
  const error = loadMoreError ?? (queryError instanceof Error ? queryError.message : queryError ? 'Falha ao carregar ordens' : null)

  return {
    rows,
    setRows,
    pendingSyncRows,
    setPendingSyncRows,
    unitOptions: freshData?.unitOptions ?? [],
    kpis,
    ownerSummary,
    reassignTargets,
    poolGroups,
    poolCentros: freshData?.poolCentros ?? {},
    highlights: highlightsData?.highlights ?? INITIAL_HIGHLIGHTS,
    isLoadingHighlights,
    isFetchingHighlights,
    nextCursor,
    isFetching,
    loadingInitial,
    loadingMore,
    error,
    currentUser,
    parentRef,
    smartSearch,
    effectiveFilters,
    fetchWorkspace,
    applyOptimisticReassignments,
  }
}
