import { NextResponse } from 'next/server'
import {
  buildFixedOwnerAvatarByAdminId,
  resolveFixedOwnerAvatarByName,
} from '@/lib/admin/admin-identity-catalog'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import {
  emptyWorkspaceKpis,
  recomputeWorkspaceKpisFromRows,
} from '@/lib/orders/workspace-kpis'
import {
  ORDERS_TIPO_ORDEM_MIGRATION_HINT,
  isRpcWithoutTipoOrdemSupport,
  parseOrdersWorkspaceRequest,
} from '@/lib/orders/workspace-query'
import {
  fetchPrivateOwnerLookupRows,
  mergeWorkspaceLookupRows,
} from '@/lib/orders/private-owner-lookup.server'
import { matchesPrivateOwnerLookupRow } from '@/lib/orders/private-owner-lookup'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import {
  applyAutomaticOrdersRouting,
  canAccessPmplTab,
  getFixedOwnerLabelByAdminId,
  resolveCurrentPmplOwner,
} from '@/lib/orders/pmpl-routing'
import type {
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
  OrdersOwnerSummary,
  OrdersPoolGroup,
  OrdersWorkspaceHighlights,
  OrdersWorkspaceKpis,
  OrdersWorkspaceResponse,
  TipoUnidade,
} from '@/lib/types/database'

type RpcError = { code?: string; message: string } | null
type SupabaseClient = Awaited<ReturnType<typeof createClient>>

const WORKSPACE_HIGHLIGHT_LIMIT = 6
const WORKSPACE_HIGHLIGHT_FETCH_LIMIT = 24
const WORKSPACE_PENDING_SYNC_LIMIT = 24

function mapKpis(value: Partial<OrdersWorkspaceKpis> | null | undefined): OrdersWorkspaceKpis {
  return {
    total: Number(value?.total ?? 0),
    abertas: Number(value?.abertas ?? 0),
    em_tratativa: Number(value?.em_tratativa ?? 0),
    em_avaliacao: Number(value?.em_avaliacao ?? 0),
    concluidas: Number(value?.concluidas ?? 0),
    canceladas: Number(value?.canceladas ?? 0),
    avaliadas: Number(value?.avaliadas ?? 0),
    atrasadas: Number(value?.atrasadas ?? 0),
    sem_responsavel: Number(value?.sem_responsavel ?? 0),
  }
}

function mapRpcError(error: { code?: string; message?: string } | null): RpcError {
  if (!error?.message) return null
  return {
    code: error.code,
    message: error.message,
  }
}

function hasRpcToken(
  error: { message?: string; details?: string | null; hint?: string | null } | null,
  token: string
): boolean {
  if (!error) return false
  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return haystack.includes(token.toLowerCase())
}

function isMissingRpc(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  return hasRpcToken(error, 'schema cache') || hasRpcToken(error, 'does not exist')
}

async function callRpcWithOptionalTipoOrdem<T>(
  supabase: SupabaseClient,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: RpcError; supportsTipoOrdem: boolean }> {
  const withTipo = await supabase.rpc(rpcName, params)
  if (withTipo.error && isRpcWithoutTipoOrdemSupport(withTipo.error)) {
    const fallbackParams = { ...params }
    delete fallbackParams.p_tipo_ordem

    const fallback = await supabase.rpc(rpcName, fallbackParams)
    return {
      data: (fallback.data ?? null) as T | null,
      error: fallback.error ? { code: fallback.error.code, message: fallback.error.message } : null,
      supportsTipoOrdem: false,
    }
  }

  return {
    data: (withTipo.data ?? null) as T | null,
    error: withTipo.error ? { code: withTipo.error.code, message: withTipo.error.message } : null,
    supportsTipoOrdem: true,
  }
}

async function callOptionalRpc<T>(
  supabase: SupabaseClient,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: RpcError; available: boolean }> {
  const result = await supabase.rpc(rpcName, params)
  if (isMissingRpc(result.error)) {
    return {
      data: null,
      error: null,
      available: false,
    }
  }

  return {
    data: (result.data ?? null) as T | null,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    available: true,
  }
}

function markRowsAsPendingSync(rows: OrdemNotaAcompanhamento[]): OrdemNotaAcompanhamento[] {
  return rows.map((row) => ({
    ...row,
    aguardando_confirmacao_sync: true,
  }))
}

function buildHighlightStatus(status: string | null): string {
  if (!status || status === 'todas') return 'ativas'
  return status
}

async function fetchWorkspaceHighlightRows(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  prioridade: 'vermelho' | 'amarelo',
  supportsTipoOrdem: boolean,
  limit = WORKSPACE_HIGHLIGHT_LIMIT,
): Promise<{ data: OrdemNotaAcompanhamento[]; error: RpcError }> {
  const rpcParams: Record<string, unknown> = {
    ...params,
    p_status: buildHighlightStatus((params.p_status as string | null | undefined) ?? null),
    p_prioridade: prioridade,
  }

  if (!supportsTipoOrdem) {
    delete rpcParams.p_tipo_ordem
  }

  const result = await supabase
    .rpc('filtrar_ordens_workspace', rpcParams)
    .order('dias_em_aberto', { ascending: false })
    .order('ordem_detectada_em', { ascending: true })
    .limit(limit)

  return {
    data: (result.data ?? []) as OrdemNotaAcompanhamento[],
    error: mapRpcError(result.error),
  }
}

function normalizeUnitName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function buildUnitOptionsFromRows(rows: Array<Pick<OrdemNotaAcompanhamento, 'unidade'>>): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row.unidade?.trim() ?? '')
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function resolveUnitType(unidade: string | null | undefined): TipoUnidade | null {
  const normalized = normalizeUnitName(unidade)
  if (!normalized) return null
  if (normalized.startsWith('CD ') || normalized.endsWith(' CD')) return 'CD'
  if (normalized.startsWith('FARMA ') || normalized.startsWith('BEMOL FARMA ')) return 'FARMA'
  return 'LOJA'
}

function prioritizeOldestHighlights(rows: OrdemNotaAcompanhamento[]): OrdemNotaAcompanhamento[] {
  return [...rows]
    .sort((a, b) => {
      const aType = resolveUnitType(a.unidade)
      const bType = resolveUnitType(b.unidade)
      const aTypeScore = aType === 'CD' ? 1 : 0
      const bTypeScore = bType === 'CD' ? 1 : 0
      if (aTypeScore !== bTypeScore) return aTypeScore - bTypeScore

      if (a.dias_em_aberto !== b.dias_em_aberto) return b.dias_em_aberto - a.dias_em_aberto

      const aDetected = Date.parse(a.ordem_detectada_em)
      const bDetected = Date.parse(b.ordem_detectada_em)
      if (Number.isFinite(aDetected) && Number.isFinite(bDetected) && aDetected !== bDetected) {
        return aDetected - bDetected
      }

      return a.ordem_codigo.localeCompare(b.ordem_codigo, 'pt-BR')
    })
    .slice(0, WORKSPACE_HIGHLIGHT_LIMIT)
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const currentAdminContext = await getCurrentRequestAdminContext({
    supabase,
    allowMaintainerView: true,
  })

  if (!currentAdminContext.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!currentAdminContext.adminId || !currentAdminContext.role) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const url = new URL(request.url)
  const role = currentAdminContext.role
  const canViewGlobal = currentAdminContext.canViewGlobal
  const canManageWorkspace = currentAdminContext.isGestor

  let fixedOwnerLabelByAdminId = new Map<string, string>()
  try {
    fixedOwnerLabelByAdminId = await getFixedOwnerLabelByAdminId(supabase)
  } catch (error) {
    logger.warn('[orders/workspace] nao foi possivel carregar labels fixos de CD:', error)
  }

  const fixedOwnerAvatarByAdminId = buildFixedOwnerAvatarByAdminId(fixedOwnerLabelByAdminId)

  let canAccessPmpl = canViewGlobal
  if (!canViewGlobal) {
    try {
      const pmplResolution = await resolveCurrentPmplOwner(supabase)
      canAccessPmpl = canAccessPmplTab({
        role,
        loggedAdminId: currentAdminContext.adminId,
        pmplResolution,
      })
    } catch (error) {
      canAccessPmpl = false
      logger.warn('[orders/workspace] fallback canAccessPmpl=false por falha ao resolver configuracao PMPL:', error)
    }
  }

  const parsedRequest = parseOrdersWorkspaceRequest(url.searchParams, canAccessPmpl)
  const skipHighlights = url.searchParams.get('skip_highlights') === '1'
  const highlightsOnly = url.searchParams.get('highlights_only') === '1'
  const adminScope = canViewGlobal ? null : currentAdminContext.adminId
  const responsavelFilter = canViewGlobal ? parsedRequest.responsavel : null
  const privateOwnerLookupPromise = !canViewGlobal && role === 'admin'
    ? fetchPrivateOwnerLookupRows(supabase, parsedRequest)
    : Promise.resolve({ rows: [] as OrdemNotaAcompanhamento[], error: null, lookupToken: null })

  const rowsRpcParams = {
    p_period_mode: parsedRequest.periodMode,
    p_year: parsedRequest.year,
    p_month: parsedRequest.month,
    p_start_iso: parsedRequest.startIso,
    p_end_exclusive_iso: parsedRequest.endExclusiveIso,
    p_status: parsedRequest.status,
    p_unidade: parsedRequest.unidade,
    p_responsavel: responsavelFilter,
    p_prioridade: parsedRequest.prioridade,
    p_q: parsedRequest.q,
    p_admin_scope: adminScope,
    p_tipo_ordem: parsedRequest.tipoOrdem,
    p_cursor_detectada: parsedRequest.cursorDetectada,
    p_cursor_ordem_id: parsedRequest.cursorOrdemId,
    p_limit: parsedRequest.limit,
  } satisfies Record<string, unknown>

  const kpisRpcParams = {
    p_period_mode: parsedRequest.periodMode,
    p_year: parsedRequest.year,
    p_month: parsedRequest.month,
    p_start_iso: parsedRequest.startIso,
    p_end_exclusive_iso: parsedRequest.endExclusiveIso,
    p_status: null,
    p_unidade: null,
    p_responsavel: null,
    p_prioridade: null,
    p_q: null,
    p_admin_scope: adminScope,
    p_tipo_ordem: parsedRequest.tipoOrdem,
  } satisfies Record<string, unknown>

  const summaryRpcParams = {
    p_period_mode: parsedRequest.periodMode,
    p_year: parsedRequest.year,
    p_month: parsedRequest.month,
    p_start_iso: parsedRequest.startIso,
    p_end_exclusive_iso: parsedRequest.endExclusiveIso,
    p_status: parsedRequest.status,
    p_unidade: parsedRequest.unidade,
    p_responsavel: responsavelFilter,
    p_prioridade: parsedRequest.prioridade,
    p_q: parsedRequest.q,
    p_admin_scope: adminScope,
    p_tipo_ordem: parsedRequest.tipoOrdem,
  } satisfies Record<string, unknown>

  const unitsRpcParams = {
    ...summaryRpcParams,
    p_unidade: null,
    p_q: null,
  } satisfies Record<string, unknown>

  const shouldLoadPendingSyncRows = !parsedRequest.cursorDetectada && !parsedRequest.cursorOrdemId

  const pendingSyncRpcParams = {
    p_period_mode: parsedRequest.periodMode,
    p_year: parsedRequest.year,
    p_month: parsedRequest.month,
    p_start_iso: parsedRequest.startIso,
    p_end_exclusive_iso: parsedRequest.endExclusiveIso,
    p_status: parsedRequest.status,
    p_unidade: parsedRequest.unidade,
    p_responsavel: responsavelFilter,
    p_prioridade: parsedRequest.prioridade,
    p_q: parsedRequest.q,
    p_admin_scope: adminScope,
    p_limit: WORKSPACE_PENDING_SYNC_LIMIT,
    p_tipo_ordem: parsedRequest.tipoOrdem,
  } satisfies Record<string, unknown>

  const poolRpcParams = {
    p_period_mode: parsedRequest.periodMode,
    p_year: parsedRequest.year,
    p_month: parsedRequest.month,
    p_start_iso: parsedRequest.startIso,
    p_end_exclusive_iso: parsedRequest.endExclusiveIso,
    p_tipo_ordem: parsedRequest.tipoOrdem,
  }

  if (highlightsOnly) {
    if (role === 'viewer') {
      return NextResponse.json({ highlights: { oldest: [], attention: [] } })
    }

    const [oldestResult, attentionResult] = await Promise.all([
      fetchWorkspaceHighlightRows(supabase, summaryRpcParams, 'vermelho', true, WORKSPACE_HIGHLIGHT_FETCH_LIMIT),
      fetchWorkspaceHighlightRows(supabase, summaryRpcParams, 'amarelo', true),
    ])

    const needsFallback =
      (oldestResult.error !== null && isRpcWithoutTipoOrdemSupport(oldestResult.error)) ||
      (attentionResult.error !== null && isRpcWithoutTipoOrdemSupport(attentionResult.error))

    if (needsFallback) {
      const [oldestRetry, attentionRetry] = await Promise.all([
        fetchWorkspaceHighlightRows(supabase, summaryRpcParams, 'vermelho', false, WORKSPACE_HIGHLIGHT_FETCH_LIMIT),
        fetchWorkspaceHighlightRows(supabase, summaryRpcParams, 'amarelo', false),
      ])
      if (oldestRetry.error) return NextResponse.json({ error: oldestRetry.error.message }, { status: 500 })
      if (attentionRetry.error) return NextResponse.json({ error: attentionRetry.error.message }, { status: 500 })
      return NextResponse.json({
        highlights: {
          oldest: prioritizeOldestHighlights(oldestRetry.data),
          attention: attentionRetry.data,
        },
      })
    }

    if (oldestResult.error) return NextResponse.json({ error: oldestResult.error.message }, { status: 500 })
    if (attentionResult.error) return NextResponse.json({ error: attentionResult.error.message }, { status: 500 })
    return NextResponse.json({
      highlights: {
        oldest: prioritizeOldestHighlights(oldestResult.data),
        attention: attentionResult.data,
      },
    })
  }

  const [rowsResult, kpisResult, summaryResult, unitsResult, targetsResult, poolResult, poolCentrosResult, pendingSyncResult, privateOwnerLookupResult] = await Promise.all([
    callRpcWithOptionalTipoOrdem<OrdemNotaAcompanhamento[]>(supabase, 'buscar_ordens_workspace', rowsRpcParams),
    callRpcWithOptionalTipoOrdem<OrdersWorkspaceKpis>(supabase, 'calcular_kpis_ordens_operacional', kpisRpcParams),
    callRpcWithOptionalTipoOrdem<Array<Partial<OrdersOwnerSummary>>>(supabase, 'calcular_resumo_colaboradores_ordens', summaryRpcParams),
    callRpcWithOptionalTipoOrdem<Array<Pick<OrdemNotaAcompanhamento, 'unidade'>>>(supabase, 'filtrar_ordens_workspace', unitsRpcParams),
    canManageWorkspace
      ? supabase
        .from('administradores')
        .select('id, nome, avatar_url, especialidade')
        .eq('role', 'admin')
        .eq('ativo', true)
        .eq('em_ferias', false)
        .order('nome')
      : Promise.resolve({ data: [] as OrderReassignTarget[], error: null }),
    canViewGlobal
      ? supabase.rpc('calcular_resumo_pool_centros', poolRpcParams)
      : Promise.resolve({ data: [], error: null }),
    canViewGlobal
      ? supabase.from('centros_pool').select('centro, pool_nome')
      : Promise.resolve({ data: [], error: null }),
    shouldLoadPendingSyncRows
      ? callOptionalRpc<OrdemNotaAcompanhamento[]>(supabase, 'buscar_ordens_sync_pendente_workspace', pendingSyncRpcParams)
      : Promise.resolve({ data: [] as OrdemNotaAcompanhamento[], error: null, available: false }),
    privateOwnerLookupPromise,
  ])

  if (rowsResult.error) {
    return NextResponse.json({ error: rowsResult.error.message }, { status: 500 })
  }

  if (kpisResult.error) {
    return NextResponse.json({ error: kpisResult.error.message }, { status: 500 })
  }

  if (summaryResult.error) {
    return NextResponse.json({ error: summaryResult.error.message }, { status: 500 })
  }

  if (unitsResult.error) {
    return NextResponse.json({ error: unitsResult.error.message }, { status: 500 })
  }

  if (targetsResult.error) {
    return NextResponse.json({ error: targetsResult.error.message }, { status: 500 })
  }

  if (pendingSyncResult.error) {
    return NextResponse.json({ error: pendingSyncResult.error.message }, { status: 500 })
  }

  if (privateOwnerLookupResult.error) {
    return NextResponse.json({ error: privateOwnerLookupResult.error }, { status: 500 })
  }

  const tipoOrdemSupportedByDb = rowsResult.supportsTipoOrdem && kpisResult.supportsTipoOrdem && summaryResult.supportsTipoOrdem && unitsResult.supportsTipoOrdem
  if (parsedRequest.tipoOrdem === 'PMPL' && !tipoOrdemSupportedByDb) {
    return NextResponse.json({ error: ORDERS_TIPO_ORDEM_MIGRATION_HINT }, { status: 412 })
  }

  if (process.env.DEBUG_ORDERS_ROUTING === '1' && !tipoOrdemSupportedByDb) {
    logger.warn('[orders/workspace] fallback sem p_tipo_ordem ativo. Resultado pode nao refletir separacao PMPL/PMOS.')
  }

  const rowsFromRpc = (rowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  let rows = rowsFromRpc
  let unitOptions = buildUnitOptionsFromRows((unitsResult.data ?? []) as Array<Pick<OrdemNotaAcompanhamento, 'unidade'>>)

  let ownerSummary = ((summaryResult.data ?? []) as Array<Partial<OrdersOwnerSummary>>).map((item) => {
    const adminId = item.administrador_id ?? null
    const fixedName = adminId ? fixedOwnerLabelByAdminId.get(adminId) ?? null : null
    const fallbackAvatar = (
      (adminId ? fixedOwnerAvatarByAdminId.get(adminId) ?? null : null)
      ?? resolveFixedOwnerAvatarByName(fixedName ?? item.nome ?? null)
    )
    const avatarFromData = typeof item.avatar_url === 'string' ? item.avatar_url.trim() : ''

    return {
      administrador_id: adminId,
      nome: fixedName ?? item.nome ?? 'Sem nome',
      avatar_url: avatarFromData.length > 0 ? avatarFromData : fallbackAvatar,
      total: Number(item.total ?? 0),
      abertas: Number(item.abertas ?? 0),
      recentes: Number(item.recentes ?? 0),
      atencao: Number(item.atencao ?? 0),
      atrasadas: Number(item.atrasadas ?? 0),
    }
  })

  const kpisFromRpc = mapKpis(kpisResult.data)
  const pendingSyncRows = shouldLoadPendingSyncRows
    ? markRowsAsPendingSync((pendingSyncResult.data ?? []) as OrdemNotaAcompanhamento[])
    : []

  let discardedRows = 0
  let discardedSummary = 0

  if (!canViewGlobal) {
    const scopedRows = rows.filter((row) => row.responsavel_atual_id === currentAdminContext.adminId)
    const scopedSummary = ownerSummary.filter((item) => item.administrador_id === currentAdminContext.adminId)

    discardedRows = rows.length - scopedRows.length
    discardedSummary = ownerSummary.length - scopedSummary.length

    rows = scopedRows
    ownerSummary = scopedSummary

    if (discardedRows > 0 || discardedSummary > 0) {
      logger.warn('[orders/workspace] escopo privado descartou dados fora do admin logado', {
        adminId: currentAdminContext.adminId,
        discardedRows,
        discardedSummary,
        rowsFromRpc: rowsFromRpc.length,
        summaryFromRpc: ownerSummary.length + discardedSummary,
      })
    }
  }

  const privateLookupRows = privateOwnerLookupResult.lookupToken
    ? mergeWorkspaceLookupRows(
      rows.filter((row) => matchesPrivateOwnerLookupRow(row, privateOwnerLookupResult.lookupToken)),
      privateOwnerLookupResult.rows,
    )
    : []
  const privateOwnerLookupActive = privateOwnerLookupResult.lookupToken !== null

  let pendingRowsForResponse = pendingSyncRows

  if (privateOwnerLookupActive) {
    rows = privateLookupRows
    unitOptions = buildUnitOptionsFromRows(rows)
    ownerSummary = []
    pendingRowsForResponse = []
  }

  const kpis = privateOwnerLookupActive
    ? recomputeWorkspaceKpisFromRows(rows)
    : (!canViewGlobal && (discardedRows > 0 || discardedSummary > 0))
        ? recomputeWorkspaceKpisFromRows(rows)
        : kpisFromRpc

  let highlights: OrdersWorkspaceHighlights = {
    oldest: [],
    attention: [],
  }

  if (!skipHighlights && !privateOwnerLookupActive && role !== 'viewer') {
    const [oldestHighlightsResult, attentionHighlightsResult] = await Promise.all([
      fetchWorkspaceHighlightRows(supabase, summaryRpcParams, 'vermelho', rowsResult.supportsTipoOrdem, WORKSPACE_HIGHLIGHT_FETCH_LIMIT),
      fetchWorkspaceHighlightRows(supabase, summaryRpcParams, 'amarelo', rowsResult.supportsTipoOrdem),
    ])

    if (oldestHighlightsResult.error) {
      return NextResponse.json({ error: oldestHighlightsResult.error.message }, { status: 500 })
    }

    if (attentionHighlightsResult.error) {
      return NextResponse.json({ error: attentionHighlightsResult.error.message }, { status: 500 })
    }

    highlights = {
      oldest: prioritizeOldestHighlights(oldestHighlightsResult.data),
      attention: attentionHighlightsResult.data,
    }
  }

  const lastCursorRow = rowsFromRpc.length > 0 ? rowsFromRpc[rowsFromRpc.length - 1] : null
  const nextCursor = privateOwnerLookupActive
    ? null
    : rowsFromRpc.length === parsedRequest.limit && lastCursorRow
    ? {
      ordem_detectada_em: lastCursorRow.ordem_detectada_em,
      ordem_id: lastCursorRow.ordem_id,
    }
    : null

  const reassignTargets = ((targetsResult.data ?? []) as OrderReassignTarget[]).map((target) => {
    const avatarFromData = typeof target.avatar_url === 'string' ? target.avatar_url.trim() : ''
    const fallbackAvatar = fixedOwnerAvatarByAdminId.get(target.id) ?? resolveFixedOwnerAvatarByName(target.nome)

    return {
      ...target,
      avatar_url: avatarFromData.length > 0 ? avatarFromData : fallbackAvatar,
    }
  })

  const poolGroups: Array<Omit<OrdersPoolGroup, 'rows'>> = ((poolResult.data ?? []) as Array<{
    pool_nome: string; pool_label: string; total: number; atrasadas: number; atencao: number; abertas: number
  }>).map((p) => ({
    pool_nome: p.pool_nome,
    pool_label: p.pool_label,
    total: Number(p.total ?? 0),
    atrasadas: Number(p.atrasadas ?? 0),
    atencao: Number(p.atencao ?? 0),
    abertas: Number(p.abertas ?? 0),
  }))

  const poolCentros: Record<string, string> = {}
  for (const row of ((poolCentrosResult.data ?? []) as Array<{ centro: string; pool_nome: string }>)) {
    poolCentros[row.centro] = row.pool_nome
  }

  const response: OrdersWorkspaceResponse = {
    rows,
    pendingSyncRows: pendingRowsForResponse,
    nextCursor,
    unitOptions,
    kpis: kpis ?? emptyWorkspaceKpis(),
    ownerSummary,
    reassignTargets,
    poolGroups,
    poolCentros,
    highlights,
    currentUser: {
      role,
      adminId: currentAdminContext.adminId,
      canViewGlobal,
      canAccessPmpl,
      maintainerViewActive: currentAdminContext.maintainerViewActive,
    },
  }

  return NextResponse.json(response)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const currentAdminContext = await getCurrentRequestAdminContext({ supabase })

  if (!currentAdminContext.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!currentAdminContext.adminId || !currentAdminContext.actualRole) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  if (currentAdminContext.actualRole !== 'gestor') {
    return NextResponse.json({ error: 'Apenas gestores podem acionar o roteamento' }, { status: 403 })
  }

  const debug = new URL(request.url).searchParams.get('debug') === '1'
    || process.env.DEBUG_ORDERS_ROUTING === '1'

  try {
    const result = await applyAutomaticOrdersRouting({
      supabase,
      gestorId: currentAdminContext.adminId,
      debug,
      motivo: 'Roteamento manual PMPL/Refrigeracao/CD',
    })

    return NextResponse.json({
      movedCount: result.movedCount,
      pendingCount: result.pendingCount,
      conflictCount: result.conflictCount,
      detectedPmpl: result.detectedPmpl,
      detectedByUnit: result.detectedByUnit,
    })
  } catch (error) {
    logger.error('[orders/routing] falha ao aplicar realocacao:', error)
    return NextResponse.json({ error: 'Falha ao aplicar roteamento automatico' }, { status: 500 })
  }
}
