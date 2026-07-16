import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  matchesPrivateOwnerLookupRow,
  normalizePrivateOwnerLookupValue,
} from '@/lib/orders/private-owner-lookup'
import {
  isRawOrderAvaliada,
  isRawOrderEmAvaliacao,
  isRawOrderNaoRealizada,
} from '@/lib/orders/status-raw'
import { parseOrdersWorkspaceRequest } from '@/lib/orders/workspace-query'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

type SupabaseClient = ReturnType<typeof createAdminClient>
type ParsedOrdersWorkspaceRequest = ReturnType<typeof parseOrdersWorkspaceRequest>

const LOOKUP_VIEW_LIMIT = 50

type OrdersLookupViewName = 'vw_ordens_notas_painel' | 'vw_ordens_notas_sync_pendente'

function hasMessage(
  error: { message?: string; details?: string | null; hint?: string | null } | null,
  token: string,
): boolean {
  if (!error) return false
  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return haystack.includes(token.toLowerCase())
}

function isMissingRelation(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null,
): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || hasMessage(error, 'does not exist')
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

function sortWorkspaceRows(rows: OrdemNotaAcompanhamento[]): OrdemNotaAcompanhamento[] {
  return [...rows].sort((a, b) => {
    const detectedDiff = toTimestamp(b.ordem_detectada_em) - toTimestamp(a.ordem_detectada_em)
    if (detectedDiff !== 0) return detectedDiff
    return b.ordem_id.localeCompare(a.ordem_id, 'pt-BR')
  })
}

function matchesPeriod(
  row: OrdemNotaAcompanhamento,
  parsedRequest: ParsedOrdersWorkspaceRequest,
): boolean {
  if (parsedRequest.periodMode === 'all') return true

  const detectedAt = new Date(row.ordem_detectada_em)
  if (Number.isNaN(detectedAt.getTime())) return false

  const year = detectedAt.getUTCFullYear()
  const month = detectedAt.getUTCMonth() + 1
  const detectedMs = detectedAt.getTime()

  if (parsedRequest.periodMode === 'year') {
    return parsedRequest.year !== null && year === parsedRequest.year
  }

  if (parsedRequest.periodMode === 'year_month') {
    return (
      parsedRequest.year !== null
      && parsedRequest.month !== null
      && year === parsedRequest.year
      && month === parsedRequest.month
    )
  }

  if (parsedRequest.periodMode === 'month') {
    return parsedRequest.month !== null && month === parsedRequest.month
  }

  if (parsedRequest.periodMode === 'range') {
    const startMs = toTimestamp(parsedRequest.startIso)
    const endMs = toTimestamp(parsedRequest.endExclusiveIso)
    return Number.isFinite(startMs) && Number.isFinite(endMs) && detectedMs >= startMs && detectedMs < endMs
  }

  return true
}

function matchesStatus(
  row: OrdemNotaAcompanhamento,
  status: string | null,
): boolean {
  if (!status || status === 'todas') return true

  if (status === 'ativas') {
    return row.status_ordem !== 'concluida' && row.status_ordem !== 'cancelada'
  }

  if (status === 'em_avaliacao') return isRawOrderEmAvaliacao(row.status_ordem_raw)
  if (status === 'avaliadas') return isRawOrderAvaliada(row.status_ordem_raw)
  if (status === 'nao_realizada') return isRawOrderNaoRealizada(row.status_ordem_raw)

  if (status === 'em_tratativa') {
    return (
      row.status_ordem === 'em_tratativa'
      && !isRawOrderEmAvaliacao(row.status_ordem_raw)
      && !isRawOrderNaoRealizada(row.status_ordem_raw)
    )
  }

  return row.status_ordem === status
}

function matchesTipoOrdem(
  row: OrdemNotaAcompanhamento,
  tipoOrdem: 'PMOS' | 'PMPL' | null,
): boolean {
  if (!tipoOrdem) return true
  if (tipoOrdem === 'PMPL') return row.tipo_ordem === 'PMPL'
  return row.tipo_ordem === null || row.tipo_ordem !== 'PMPL'
}

function matchesWorkspaceLookupFilters(
  row: OrdemNotaAcompanhamento,
  parsedRequest: ParsedOrdersWorkspaceRequest,
): boolean {
  if (!matchesPeriod(row, parsedRequest)) return false
  if (!matchesStatus(row, parsedRequest.status)) return false
  if (parsedRequest.unidade && row.unidade !== parsedRequest.unidade) return false
  if (parsedRequest.prioridade && row.semaforo_atraso !== parsedRequest.prioridade) return false
  if (!matchesTipoOrdem(row, parsedRequest.tipoOrdem)) return false
  return true
}

async function queryLookupView(
  supabase: SupabaseClient,
  viewName: OrdersLookupViewName,
  normalizedLookup: string,
): Promise<{ rows: OrdemNotaAcompanhamento[]; error: string | null }> {
  const result = await supabase
    .from(viewName)
    .select('*')
    .or(`ordem_codigo.ilike.*${normalizedLookup},numero_nota.ilike.*${normalizedLookup}`)
    .order('ordem_detectada_em', { ascending: false })
    .limit(LOOKUP_VIEW_LIMIT)

  if (result.error) {
    if (viewName === 'vw_ordens_notas_sync_pendente' && isMissingRelation(result.error)) {
      return { rows: [], error: null }
    }

    return { rows: [], error: result.error.message }
  }

  const rows = ((result.data ?? []) as OrdemNotaAcompanhamento[]).map((row) => (
    viewName === 'vw_ordens_notas_sync_pendente'
      ? { ...row, aguardando_confirmacao_sync: true }
      : row
  ))

  return { rows, error: null }
}

export function mergeWorkspaceLookupRows(...collections: OrdemNotaAcompanhamento[][]): OrdemNotaAcompanhamento[] {
  const byOrderId = new Map<string, OrdemNotaAcompanhamento>()

  for (const collection of collections) {
    for (const row of collection) {
      if (!byOrderId.has(row.ordem_id)) {
        byOrderId.set(row.ordem_id, row)
      }
    }
  }

  return sortWorkspaceRows([...byOrderId.values()])
}

export async function fetchPrivateOwnerLookupRows(
  supabase: SupabaseClient,
  parsedRequest: ParsedOrdersWorkspaceRequest,
): Promise<{ rows: OrdemNotaAcompanhamento[]; error: string | null; lookupToken: string | null }> {
  const lookupToken = normalizePrivateOwnerLookupValue(parsedRequest.q)
  if (!lookupToken) {
    return { rows: [], error: null, lookupToken: null }
  }

  const [mainResult, pendingResult] = await Promise.all([
    queryLookupView(supabase, 'vw_ordens_notas_painel', lookupToken),
    queryLookupView(supabase, 'vw_ordens_notas_sync_pendente', lookupToken),
  ])

  if (mainResult.error) {
    return { rows: [], error: mainResult.error, lookupToken }
  }

  if (pendingResult.error) {
    return { rows: [], error: pendingResult.error, lookupToken }
  }

  const mergedRows = mergeWorkspaceLookupRows(mainResult.rows, pendingResult.rows)
    .filter((row) => matchesPrivateOwnerLookupRow(row, lookupToken))
    .filter((row) => matchesWorkspaceLookupFilters(row, parsedRequest))

  return {
    rows: mergedRows,
    error: null,
    lookupToken,
  }
}
