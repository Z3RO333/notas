import { NextResponse } from 'next/server'
import {
  buildFixedOwnerAvatarByAdminId,
  resolveFixedOwnerAvatarByName,
} from '@/lib/admin/admin-identity-catalog'
import {
  emptyWorkspaceKpis,
  recomputeWorkspaceKpisFromRows,
} from '@/lib/orders/workspace-kpis'
import {
  ORDERS_TIPO_ORDEM_MIGRATION_HINT,
  isRpcWithoutTipoOrdemSupport,
  parseOrdersWorkspaceRequest,
} from '@/lib/orders/workspace-query'
import { createClient } from '@/lib/supabase/server'
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
  OrdersWorkspaceKpis,
  OrdersWorkspaceResponse,
  UserRole,
} from '@/lib/types/database'

type RpcError = { code?: string; message: string } | null

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

async function callRpcWithOptionalTipoOrdem<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: loggedAdminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (loggedAdminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const role = loggedAdmin.role as UserRole
  const canViewGlobal = role === 'gestor'
  const debugOrdersRouting = process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1'

  let fixedOwnerLabelByAdminId = new Map<string, string>()
  try {
    fixedOwnerLabelByAdminId = await getFixedOwnerLabelByAdminId(supabase)
  } catch (error) {
    console.warn('[orders/workspace] nao foi possivel carregar labels fixos de CD:', error)
  }

  if (canViewGlobal) {
    try {
      const routingResult = await applyAutomaticOrdersRouting({
        supabase,
        gestorId: loggedAdmin.id,
        debug: debugOrdersRouting,
        motivo: 'Auto realocacao PMPL/Refrigeracao/CD (Painel de Ordens)',
      })
      fixedOwnerLabelByAdminId = routingResult.fixedOwnerLabelByAdminId
    } catch (error) {
      console.error('[orders/routing] falha ao aplicar realocacao automatica:', error)
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
      console.warn('[orders/workspace] fallback canAccessPmpl=false por falha ao resolver configuracao PMPL:', error)
    }
  }

  const parsedRequest = parseOrdersWorkspaceRequest(new URL(request.url).searchParams, canAccessPmpl)
  const adminScope = canViewGlobal ? null : loggedAdmin.id
  const responsavelFilter = canViewGlobal ? parsedRequest.responsavel : null

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

  const poolRpcParams = {
    p_period_mode: parsedRequest.periodMode,
    p_year: parsedRequest.year,
    p_month: parsedRequest.month,
    p_start_iso: parsedRequest.startIso,
    p_end_exclusive_iso: parsedRequest.endExclusiveIso,
    p_tipo_ordem: parsedRequest.tipoOrdem,
  }

  const [rowsResult, kpisResult, summaryResult, targetsResult, poolResult, poolCentrosResult] = await Promise.all([
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
    canViewGlobal
      ? supabase.rpc('calcular_resumo_pool_centros', poolRpcParams)
      : Promise.resolve({ data: [], error: null }),
    canViewGlobal
      ? supabase.from('centros_pool').select('centro, pool_nome')
      : Promise.resolve({ data: [], error: null }),
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
  if (parsedRequest.tipoOrdem === 'PMPL' && !tipoOrdemSupportedByDb) {
    return NextResponse.json({ error: ORDERS_TIPO_ORDEM_MIGRATION_HINT }, { status: 412 })
  }

  if (process.env.DEBUG_ORDERS_ROUTING === '1' && !tipoOrdemSupportedByDb) {
    console.warn('[orders/workspace] fallback sem p_tipo_ordem ativo. Resultado pode nao refletir separacao PMPL/PMOS.')
  }

  const rowsFromRpc = (rowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  let rows = rowsFromRpc

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

  let discardedRows = 0
  let discardedSummary = 0

  if (!canViewGlobal) {
    const scopedRows = rows.filter((row) => row.responsavel_atual_id === loggedAdmin.id)
    const scopedSummary = ownerSummary.filter((item) => item.administrador_id === loggedAdmin.id)

    discardedRows = rows.length - scopedRows.length
    discardedSummary = ownerSummary.length - scopedSummary.length

    rows = scopedRows
    ownerSummary = scopedSummary

    if (discardedRows > 0 || discardedSummary > 0) {
      console.warn('[orders/workspace] escopo privado descartou dados fora do admin logado', {
        adminId: loggedAdmin.id,
        discardedRows,
        discardedSummary,
        rowsFromRpc: rowsFromRpc.length,
        summaryFromRpc: ownerSummary.length + discardedSummary,
      })
    }
  }

  const kpis = (!canViewGlobal && (discardedRows > 0 || discardedSummary > 0))
    ? recomputeWorkspaceKpisFromRows(rows)
    : kpisFromRpc

  const lastCursorRow = rowsFromRpc.length > 0 ? rowsFromRpc[rowsFromRpc.length - 1] : null
  const nextCursor = rowsFromRpc.length === parsedRequest.limit && lastCursorRow
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
    nextCursor,
    kpis: kpis ?? emptyWorkspaceKpis(),
    ownerSummary,
    reassignTargets,
    poolGroups,
    poolCentros,
    currentUser: {
      role,
      adminId: loggedAdmin.id,
      canViewGlobal,
      canAccessPmpl,
    },
  }

  return NextResponse.json(response)
}
