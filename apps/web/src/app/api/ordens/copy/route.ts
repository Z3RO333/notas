import { NextResponse } from 'next/server'
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
import {
  canAccessPmplTab,
  loadPmplCarteira,
} from '@/lib/orders/pmpl-routing'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

export async function GET(request: Request) {
  const ctx = await getCurrentRequestAdminContext({ allowMaintainerView: true })

  if (!ctx.isAuthenticated) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }
  if (!ctx.adminId) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }
  if (ctx.role === 'viewer') {
    return NextResponse.json({ error: 'Viewer nao pode copiar ordens em lote' }, { status: 403 })
  }

  const supabase = await createClient()
  const url = new URL(request.url)
  const { role, canViewGlobal, adminId } = ctx

  let canAccessPmpl = canViewGlobal
  if (!canViewGlobal && role) {
    try {
      const { adminIds: pmplAdminIds } = await loadPmplCarteira(supabase)
      canAccessPmpl = canAccessPmplTab({
        role,
        loggedAdminId: adminId!,
        pmplAdminIds,
      })
    } catch {
      canAccessPmpl = false
    }
  }

  const parsedRequest = parseOrdersWorkspaceRequest(url.searchParams, canAccessPmpl)
  const adminScope = canViewGlobal ? null : adminId
  const responsavelFilter = canViewGlobal ? parsedRequest.responsavel : null
  const privateOwnerLookupResult = !canViewGlobal && role === 'admin'
    ? await fetchPrivateOwnerLookupRows(supabase, parsedRequest)
    : { rows: [] as OrdemNotaAcompanhamento[], error: null, lookupToken: null }

  const rpcParams: Record<string, unknown> = {
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
  }

  let rpcResult = await supabase.rpc('buscar_ordens_workspace', rpcParams)

  if (rpcResult.error && isRpcWithoutTipoOrdemSupport(rpcResult.error)) {
    if (parsedRequest.tipoOrdem === 'PMPL') {
      return NextResponse.json({ error: ORDERS_TIPO_ORDEM_MIGRATION_HINT }, { status: 412 })
    }
    const fallbackParams = { ...rpcParams }
    delete fallbackParams.p_tipo_ordem
    rpcResult = await supabase.rpc('buscar_ordens_workspace', fallbackParams)
  }

  if (rpcResult.error) {
    return NextResponse.json({ error: rpcResult.error.message }, { status: 500 })
  }

  if (privateOwnerLookupResult.error) {
    return NextResponse.json({ error: privateOwnerLookupResult.error }, { status: 500 })
  }

  const rowsFromRpc = (rpcResult.data ?? []) as OrdemNotaAcompanhamento[]

  const rows = privateOwnerLookupResult.lookupToken
    ? mergeWorkspaceLookupRows(
      rowsFromRpc.filter((row) => row.responsavel_atual_id === adminId)
        .filter((row) => matchesPrivateOwnerLookupRow(row, privateOwnerLookupResult.lookupToken)),
      privateOwnerLookupResult.rows,
    )
    : canViewGlobal
        ? rowsFromRpc
        : rowsFromRpc.filter((row) => row.responsavel_atual_id === adminId)

  const lastRow = rowsFromRpc.length > 0 ? rowsFromRpc[rowsFromRpc.length - 1] : null
  const nextCursor = privateOwnerLookupResult.lookupToken
    ? null
    : rowsFromRpc.length === parsedRequest.limit && lastRow
    ? {
      ordem_detectada_em: lastRow.ordem_detectada_em,
      ordem_id: lastRow.ordem_id,
    }
    : null

  return NextResponse.json({ rows, nextCursor })
}
