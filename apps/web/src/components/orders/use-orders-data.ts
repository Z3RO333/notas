import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { buildWorkspaceParams } from '@/lib/orders/workspace-query'
import { createOrdersWorkspaceQueryKeys } from '@/lib/orders/workspace-query-keys'
import { sanitizeText } from '@/components/orders/use-orders-filters'
import type {
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
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
    const matches = ownerCandidates.filter((owner) => normalizeSearchToken(owner.nome).includes(normalized))
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
  const [nextCursor, setNextCursor] = useState<OrdersWorkspaceCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<OrdersDataUser>(initialUser)
  const [reassignTargets, setReassignTargets] = useState<OrderReassignTarget[]>([])

  const parentRef = useRef<HTMLDivElement | null>(null)

  const searchOwnerCandidates = useMemo(
    () => reassignTargets.map((t) => ({ id: t.id, nome: t.nome })),
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
    kpis: freshData?.kpis ?? INITIAL_KPIS,
    ownerSummary: freshData?.ownerSummary ?? [],
    reassignTargets,
    poolGroups: (freshData?.poolGroups ?? []) as Array<Omit<OrdersPoolGroup, 'rows'>>,
    poolCentros: freshData?.poolCentros ?? {},
    highlights: highlightsData?.highlights ?? INITIAL_HIGHLIGHTS,
    isLoadingHighlights,
    isFetchingHighlights,
    nextCursor,
    loadingInitial,
    loadingMore,
    error,
    currentUser,
    parentRef,
    smartSearch,
    effectiveFilters,
    fetchWorkspace,
  }
}
