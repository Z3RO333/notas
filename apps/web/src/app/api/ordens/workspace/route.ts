import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  applyAutomaticOrdersRouting,
  canAccessPmplTab,
  getFixedOwnerLabelByAdminId,
  resolveCurrentPmplOwner,
} from '@/lib/orders/pmpl-routing'
import type {
  OrdemNotaAcompanhamento,
  OrdersOwnerSummary,
  OrdersWorkspaceCursor,
  OrdersWorkspaceKpis,
  OrdersWorkspaceResponse,
  OrdersPeriodModeOperational,
  OrderReassignTarget,
  UserRole,
} from '@/lib/types/database'

const VALID_PERIOD_MODES: OrdersPeriodModeOperational[] = ['all', 'year', 'year_month', 'month', 'range']
const VALID_STATUS = new Set([
  'todas',
  'aberta',
  'em_tratativa',
  'em_avaliacao',
  'avaliadas',
  'nao_realizada',
  'concluida',
  'cancelada',
  'desconhecido',
])
const VALID_PRIORIDADE = new Set(['todas', 'verde', 'amarelo', 'vermelho'])
const VALID_TIPO_ORDEM = new Set(['PMOS', 'PMPL', 'todas'])
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const MIGRATION_HINT_TIPO_ORDEM = 'Aplique a migration 00045_tipo_ordem_pmpl_pmos_tabs.sql para habilitar o filtro PMPL/PMOS.'
const RAW_STATUS_EM_AVALIACAO = new Set(['AVALIACAO_DA_EXECUCAO', 'AVALIACAO_DE_EXECUCAO'])
const RAW_STATUS_AVALIADA = new Set(['EXECUCAO_SATISFATORIO', 'EXECUCAO_SATISFATORIA'])
const FIXED_OWNER_AVATAR_BY_NORMALIZED_NAME: Record<string, string> = {
  brenda: '/avatars/BRENDA.jpg',
  'brenda rodrigues': '/avatars/BRENDA.jpg',
  adriano: '/avatars/ADRIANO.jpg',
  'adriano bezerra': '/avatars/ADRIANO.jpg',
}

function asText(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePersonName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function resolveFixedOwnerAvatarByName(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = normalizePersonName(value)
  if (!normalized) return null

  const directMatch = FIXED_OWNER_AVATAR_BY_NORMALIZED_NAME[normalized]
  if (directMatch) return directMatch
  if (normalized.includes('brenda')) return FIXED_OWNER_AVATAR_BY_NORMALIZED_NAME.brenda
  if (normalized.includes('adriano')) return FIXED_OWNER_AVATAR_BY_NORMALIZED_NAME.adriano
  return null
}

function buildFixedOwnerAvatarByAdminId(fixedOwnerLabelByAdminId: Map<string, string>): Map<string, string> {
  const avatarByAdminId = new Map<string, string>()

  for (const [adminId, label] of fixedOwnerLabelByAdminId.entries()) {
    const avatar = resolveFixedOwnerAvatarByName(label)
    if (avatar) avatarByAdminId.set(adminId, avatar)
  }

  return avatarByAdminId
}

function asInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  return parsed
}

function asIso(value: string | null): string | null {
  const text = asText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function asUuid(value: string | null): string | null {
  const text = asText(value)
  if (!text) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return null
  return text
}

function normalizeStatus(value: string | null): string | null {
  const text = asText(value)?.toLowerCase() ?? null
  if (!text) return null
  return VALID_STATUS.has(text) ? text : null
}

function normalizePrioridade(value: string | null): string | null {
  const text = asText(value)?.toLowerCase() ?? null
  if (!text) return null
  return VALID_PRIORIDADE.has(text) ? text : null
}

function normalizeTipoOrdem(value: string | null): 'PMOS' | 'PMPL' | 'todas' | null {
  const text = asText(value)
  if (!text) return null
  return VALID_TIPO_ORDEM.has(text) ? (text as 'PMOS' | 'PMPL' | 'todas') : null
}

function resolvePeriodMode(value: string | null): OrdersPeriodModeOperational {
  const text = asText(value)?.toLowerCase() as OrdersPeriodModeOperational | undefined
  return text && VALID_PERIOD_MODES.includes(text) ? text : 'all'
}

function resolveLimit(value: string | null): number {
  const parsed = asInt(value)
  if (!parsed) return DEFAULT_LIMIT
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function includesToken(haystack: string | null | undefined, token: string): boolean {
  return (haystack ?? '').toLowerCase().includes(token.toLowerCase())
}

function isRpcWithoutTipoOrdemSupport(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true

  return (
    includesToken(error.message, 'p_tipo_ordem')
    || includesToken(error.details, 'p_tipo_ordem')
    || includesToken(error.hint, 'p_tipo_ordem')
  )
}

async function callRpcWithOptionalTipoOrdem<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: { code?: string; message: string } | null; supportsTipoOrdem: boolean }> {
  const withTipo = await supabase.rpc(rpcName, params)
  if (withTipo.error && isRpcWithoutTipoOrdemSupport(withTipo.error)) {
    const withoutTipoParams = { ...params }
    delete withoutTipoParams.p_tipo_ordem

    const fallback = await supabase.rpc(rpcName, withoutTipoParams)
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

function emptyKpis(): OrdersWorkspaceKpis {
  return {
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
}

function normalizeRawStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function isEmAvaliacao(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return RAW_STATUS_EM_AVALIACAO.has(normalizeRawStatus(row.status_ordem_raw))
}

function isAvaliada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return RAW_STATUS_AVALIADA.has(normalizeRawStatus(row.status_ordem_raw))
}

function isNaoRealizada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeRawStatus(row.status_ordem_raw) === 'EXECUCAO_NAO_REALIZADA'
}

function isEmProcessamento(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeRawStatus(row.status_ordem_raw) === 'EM_PROCESSAMENTO'
}

function isEmExecucao(row: Pick<OrdemNotaAcompanhamento, 'status_ordem' | 'status_ordem_raw'>): boolean {
  const inExecutionStatus = row.status_ordem === 'em_tratativa' || row.status_ordem === 'desconhecido'
  if (!inExecutionStatus) return false
  return !isEmAvaliacao(row) && !isNaoRealizada(row) && !isEmProcessamento(row)
}

function recomputeKpisFromRows(rows: OrdemNotaAcompanhamento[]): OrdersWorkspaceKpis {
  return {
    total: rows.length,
    abertas: rows.filter((row) => row.status_ordem === 'aberta').length,
    em_tratativa: rows.filter((row) => isEmExecucao(row)).length,
    em_avaliacao: rows.filter((row) => isEmAvaliacao(row)).length,
    concluidas: rows.filter((row) => row.status_ordem === 'concluida' && !isAvaliada(row)).length,
    canceladas: rows.filter((row) => row.status_ordem === 'cancelada').length,
    avaliadas: rows.filter((row) => isAvaliada(row)).length,
    atrasadas: rows.filter((row) => (
      row.semaforo_atraso === 'vermelho'
      && (row.status_ordem === 'aberta' || isEmExecucao(row) || isEmAvaliacao(row))
    )).length,
    sem_responsavel: rows.filter((row) => !row.responsavel_atual_id).length,
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: loggedAdminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (loggedAdminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador não encontrado' }, { status: 403 })
  }

  const role = loggedAdmin.role as UserRole
  const canViewGlobal = role === 'gestor'
  const debugOrdersRouting = process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1'

  let fixedOwnerLabelByAdminId = new Map<string, string>()
  try {
    fixedOwnerLabelByAdminId = await getFixedOwnerLabelByAdminId(supabase)
  } catch (error) {
    console.warn('[orders/workspace] não foi possível carregar labels fixos de CD:', error)
  }

  if (canViewGlobal) {
    try {
      const routingResult = await applyAutomaticOrdersRouting({
        supabase,
        gestorId: loggedAdmin.id,
        debug: debugOrdersRouting,
        motivo: 'Auto realocação PMPL/Refrigeração/CD (Painel de Ordens)',
      })
      fixedOwnerLabelByAdminId = routingResult.fixedOwnerLabelByAdminId
    } catch (error) {
      console.error('[orders/routing] falha ao aplicar realocação automática:', error)
    }
  }

  const fixedOwnerAvatarByAdminId = buildFixedOwnerAvatarByAdminId(fixedOwnerLabelByAdminId)

  let canAccessPmpl = canViewGlobal
  if (!canViewGlobal) {
    try {
      const pmplResolution = await resolveCurrentPmplOwner(supabase)
      canAccessPmpl = canAccessPmplTab({
        role,
        loggedAdminId: loggedAdmin.id,
        pmplResolution,
      })
    } catch (error) {
      canAccessPmpl = false
      console.warn('[orders/workspace] fallback canAccessPmpl=false por falha ao resolver configuração PMPL:', error)
    }
  }

  const { searchParams } = new URL(request.url)
  const periodMode = resolvePeriodMode(searchParams.get('periodMode'))
  const year = asInt(searchParams.get('year'))
  const month = asInt(searchParams.get('month'))
  const startIso = asIso(searchParams.get('startIso'))
  const endExclusiveIso = asIso(searchParams.get('endExclusiveIso'))
  const q = asText(searchParams.get('q'))
  const status = normalizeStatus(searchParams.get('status'))
  const unidade = asText(searchParams.get('unidade'))
  const responsavel = asText(searchParams.get('responsavel'))
  const prioridade = normalizePrioridade(searchParams.get('prioridade'))
  const cursorDetectada = asIso(searchParams.get('cursorDetectada'))
  const cursorOrdemId = asUuid(searchParams.get('cursorOrdemId'))
  const limit = resolveLimit(searchParams.get('limit'))

  const requestedTipoOrdem = normalizeTipoOrdem(searchParams.get('tipoOrdem'))
  let tipoOrdem: 'PMOS' | 'PMPL' | null = requestedTipoOrdem === 'todas'
    ? null
    : (requestedTipoOrdem ?? 'PMOS')

  if (tipoOrdem === 'PMPL' && !canAccessPmpl) {
    tipoOrdem = 'PMOS'
  }

  const adminScope = canViewGlobal ? null : loggedAdmin.id
  const responsavelFilter = canViewGlobal ? responsavel : null

  const rowsRpcParams = {
    p_period_mode: periodMode,
    p_year: year,
    p_month: month,
    p_start_iso: startIso,
    p_end_exclusive_iso: endExclusiveIso,
    p_status: status,
    p_unidade: unidade,
    p_responsavel: responsavelFilter,
    p_prioridade: prioridade,
    p_q: q,
    p_admin_scope: adminScope,
    p_tipo_ordem: tipoOrdem,
    p_cursor_detectada: cursorDetectada,
    p_cursor_ordem_id: cursorOrdemId,
    p_limit: limit,
  } satisfies Record<string, unknown>

  const kpisRpcParams = {
    p_period_mode: periodMode,
    p_year: year,
    p_month: month,
    p_start_iso: startIso,
    p_end_exclusive_iso: endExclusiveIso,
    p_status: status,
    p_unidade: unidade,
    p_responsavel: responsavelFilter,
    p_prioridade: prioridade,
    p_q: q,
    p_admin_scope: adminScope,
    p_tipo_ordem: tipoOrdem,
  } satisfies Record<string, unknown>

  const summaryRpcParams = {
    p_period_mode: periodMode,
    p_year: year,
    p_month: month,
    p_start_iso: startIso,
    p_end_exclusive_iso: endExclusiveIso,
    p_status: status,
    p_unidade: unidade,
    p_responsavel: responsavelFilter,
    p_prioridade: prioridade,
    p_q: q,
    p_admin_scope: adminScope,
    p_tipo_ordem: tipoOrdem,
  } satisfies Record<string, unknown>

  const [rowsResult, kpisResult, summaryResult, targetsResult] = await Promise.all([
    callRpcWithOptionalTipoOrdem<OrdemNotaAcompanhamento[]>(supabase, 'buscar_ordens_workspace', rowsRpcParams),
    callRpcWithOptionalTipoOrdem<OrdersWorkspaceKpis>(supabase, 'calcular_kpis_ordens_operacional', kpisRpcParams),
    callRpcWithOptionalTipoOrdem<Array<Partial<OrdersOwnerSummary>>>(supabase, 'calcular_resumo_colaboradores_ordens', summaryRpcParams),
    canViewGlobal
      ? supabase
        .from('administradores')
        .select('id, nome, avatar_url, especialidade')
        .eq('role', 'admin')
        .eq('ativo', true)
        .eq('em_ferias', false)
        .order('nome')
      : Promise.resolve({ data: [] as OrderReassignTarget[], error: null }),
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

  if (targetsResult.error) {
    return NextResponse.json({ error: targetsResult.error.message }, { status: 500 })
  }

  const tipoOrdemSupportedByDb = rowsResult.supportsTipoOrdem && kpisResult.supportsTipoOrdem && summaryResult.supportsTipoOrdem
  if (tipoOrdem === 'PMPL' && !tipoOrdemSupportedByDb) {
    return NextResponse.json({ error: MIGRATION_HINT_TIPO_ORDEM }, { status: 412 })
  }

  if (process.env.DEBUG_ORDERS_ROUTING === '1' && !tipoOrdemSupportedByDb) {
    console.warn('[orders/workspace] fallback sem p_tipo_ordem ativo. Resultado pode não refletir separação PMPL/PMOS.')
  }

  const rowsFromRpc = (rowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  let rows = rowsFromRpc
  const rawSummary = (summaryResult.data ?? []) as Array<Partial<OrdersOwnerSummary>>
  let summary: OrdersOwnerSummary[] = rawSummary.map((item) => {
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
  const rawKpis = (kpisResult.data ?? {}) as Partial<OrdersWorkspaceKpis>

  if (process.env.DEBUG_KPIS === '1') {
    console.log('[DEBUG workspace/kpis] raw RPC response:', JSON.stringify(kpisResult.data))
  }

  const kpisFromRpc: OrdersWorkspaceKpis = {
    total: Number(rawKpis.total ?? 0),
    abertas: Number(rawKpis.abertas ?? 0),
    em_tratativa: Number(rawKpis.em_tratativa ?? 0),
    em_avaliacao: Number(rawKpis.em_avaliacao ?? 0),
    concluidas: Number(rawKpis.concluidas ?? 0),
    canceladas: Number(rawKpis.canceladas ?? 0),
    avaliadas: Number(rawKpis.avaliadas ?? 0),
    atrasadas: Number(rawKpis.atrasadas ?? 0),
    sem_responsavel: Number(rawKpis.sem_responsavel ?? 0),
  }

  let discardedRows = 0
  let discardedSummary = 0

  if (!canViewGlobal) {
    const scopedRows = rows.filter((row) => row.responsavel_atual_id === loggedAdmin.id)
    const scopedSummary = summary.filter((item) => item.administrador_id === loggedAdmin.id)

    discardedRows = rows.length - scopedRows.length
    discardedSummary = summary.length - scopedSummary.length

    rows = scopedRows
    summary = scopedSummary

    if (discardedRows > 0 || discardedSummary > 0) {
      console.warn(
        '[orders/workspace] escopo privado descartou dados fora do admin logado',
        {
          adminId: loggedAdmin.id,
          discardedRows,
          discardedSummary,
          rowsFromRpc: rowsFromRpc.length,
          summaryFromRpc: rawSummary.length,
        },
      )
    }
  }

  const kpis = (!canViewGlobal && (discardedRows > 0 || discardedSummary > 0))
    ? recomputeKpisFromRows(rows)
    : kpisFromRpc

  const lastCursorRow = rowsFromRpc.length > 0 ? rowsFromRpc[rowsFromRpc.length - 1] : null
  const nextCursor: OrdersWorkspaceCursor | null = rowsFromRpc.length === limit && lastCursorRow
    ? {
      ordem_detectada_em: lastCursorRow.ordem_detectada_em,
      ordem_id: lastCursorRow.ordem_id,
    }
    : null

  const response: OrdersWorkspaceResponse = {
    rows,
    nextCursor,
    kpis: kpis ?? emptyKpis(),
    ownerSummary: summary,
    reassignTargets: ((targetsResult.data ?? []) as OrderReassignTarget[]).map((target) => {
      const avatarFromData = typeof target.avatar_url === 'string' ? target.avatar_url.trim() : ''
      const fallbackAvatar = (
        fixedOwnerAvatarByAdminId.get(target.id)
        ?? resolveFixedOwnerAvatarByName(target.nome)
      )

      return {
        ...target,
        avatar_url: avatarFromData.length > 0 ? avatarFromData : fallbackAvatar,
      }
    }),
    currentUser: {
      role,
      adminId: loggedAdmin.id,
      canViewGlobal,
      canAccessPmpl,
    },
  }

  return NextResponse.json(response)
}
