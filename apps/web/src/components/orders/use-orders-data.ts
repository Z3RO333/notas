import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { buildWorkspaceParams } from '@/lib/orders/workspace-query'
import { sanitizeText } from '@/components/orders/use-orders-filters'
import type {
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
  OrdersOwnerSummary,
  OrdersPoolGroup,
  OrdersWorkspaceCursor,
  OrdersWorkspaceFilters,
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

function mergeRows(
  prev: OrdemNotaAcompanhamento[],
  incoming: OrdemNotaAcompanhamento[],
): OrdemNotaAcompanhamento[] {
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

function resolveSmartSearch(
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
  adminId: string
  canViewGlobal: boolean
  canAccessPmpl: boolean
  userEmail: string
}

interface UseOrdersDataOptions {
  filters: OrdersWorkspaceFilters
  initialUser: OrdersDataUser
  /** Called after a successful reset fetch — caller handles selection clearing and enter-search UX */
  onResetSuccess: (rows: OrdemNotaAcompanhamento[]) => Promise<void>
}

export function useOrdersData({ filters, initialUser, onResetSuccess }: UseOrdersDataOptions) {
  const { toast } = useToast()

  const [rows, setRows] = useState<OrdemNotaAcompanhamento[]>([])
  const [kpis, setKpis] = useState<OrdersWorkspaceKpis>(INITIAL_KPIS)
  const [ownerSummary, setOwnerSummary] = useState<OrdersOwnerSummary[]>([])
  const [reassignTargets, setReassignTargets] = useState<OrderReassignTarget[]>([])
  const [poolGroups, setPoolGroups] = useState<Array<Omit<OrdersPoolGroup, 'rows'>>>([])
  const [poolCentros, setPoolCentros] = useState<Record<string, string>>({})
  const [nextCursor, setNextCursor] = useState<OrdersWorkspaceCursor | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<OrdersDataUser>(initialUser)

  const fetchAbortRef = useRef<AbortController | null>(null)
  const parentRef = useRef<HTMLDivElement | null>(null)

  // Smart search uses reassignTargets from current state — no circular dependency
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

  const fetchWorkspace = useCallback(
    async (reset: boolean, cursor: OrdersWorkspaceCursor | null = null) => {
      fetchAbortRef.current?.abort()
      const controller = new AbortController()
      fetchAbortRef.current = controller

      if (reset) {
        setLoadingInitial(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }

      const reqId = Math.random().toString(36).slice(2, 8)
      const pageCursor = reset ? null : cursor

      console.debug(`[ordens:fetch:start] reqId=${reqId} reset=${reset}`, {
        filtros: { ...effectiveFilters, q: effectiveFilters.q ? '***' : '', searchMode: smartSearch.mode },
        cursor: pageCursor,
      })

      try {
        const params = buildWorkspaceParams(effectiveFilters, pageCursor, BATCH_SIZE)
        const response = await fetch(`/api/ordens/workspace?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error || 'Falha ao carregar ordens')
        }

        const payload = (await response.json()) as OrdersWorkspaceResponse

        console.debug(`[ordens:fetch:done] reqId=${reqId}`, {
          rows: payload.rows.length,
          total: payload.kpis.total,
          cursor: payload.nextCursor ?? 'fim',
        })

        if (process.env.NODE_ENV === 'development') {
          const k = payload.kpis
          const soma = k.abertas + k.em_tratativa + k.concluidas + k.canceladas
          if (soma !== k.total) {
            console.warn('[ordens:consistencia] total !== soma de status principais', {
              total: k.total, soma, diff: k.total - soma,
              nota: 'atrasadas e avaliadas são dimensões ortogonais — não entram na soma',
            })
          }
          const ids = payload.rows.map((r) => r.ordem_id)
          const uniq = new Set(ids)
          if (uniq.size !== ids.length) {
            console.warn('[ordens:consistencia] linhas duplicadas detectadas na página', {
              total: ids.length, unique: uniq.size, duplicatas: ids.length - uniq.size,
            })
          }
        }

        setCurrentUser((prev) => ({ ...payload.currentUser, userEmail: prev.userEmail }))
        setKpis(payload.kpis)
        setOwnerSummary(payload.ownerSummary)
        setReassignTargets(payload.reassignTargets)
        setPoolGroups(payload.poolGroups ?? [])
        setPoolCentros(payload.poolCentros ?? {})
        setNextCursor(payload.nextCursor)

        if (reset) {
          setRows(payload.rows)
          await onResetSuccess(payload.rows)
        } else {
          setRows((prev) => mergeRows(prev, payload.rows))
        }
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return
        const message = fetchError instanceof Error ? fetchError.message : 'Falha ao carregar ordens'
        setError(message)
        if (reset) {
          setRows([])
          setNextCursor(null)
        }
      } finally {
        // Se o fetch foi abortado (ex: novo filtro aplicado enquanto este estava em voo),
        // não alterar o estado de loading — o fetch substituto já assumiu o controle.
        if (controller.signal.aborted) return
        if (reset) setLoadingInitial(false)
        setLoadingMore(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveFilters, smartSearch.mode, onResetSuccess, toast],
  )

  // Trigger fresh fetch whenever effectiveFilters change; scroll list to top
  useEffect(() => {
    setNextCursor(null)
    parentRef.current?.scrollTo({ top: 0 })
    fetchWorkspace(true)
    return () => fetchAbortRef.current?.abort()
  }, [fetchWorkspace])

  return {
    rows,
    setRows,
    kpis,
    ownerSummary,
    reassignTargets,
    poolGroups,
    poolCentros,
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
