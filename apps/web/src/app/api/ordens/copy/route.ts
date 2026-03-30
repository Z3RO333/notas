import { NextResponse } from 'next/server'
import {
  ORDERS_TIPO_ORDEM_MIGRATION_HINT,
  isRpcWithoutTipoOrdemSupport,
  parseOrdersWorkspaceRequest,
} from '@/lib/orders/workspace-query'
import { createClient } from '@/lib/supabase/server'
import {
  canAccessPmplTab,
  resolveCurrentPmplOwner,
} from '@/lib/orders/pmpl-routing'
import type { OrdemNotaAcompanhamento, UserRole } from '@/lib/types/database'

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
  if (role === 'viewer') {
    return NextResponse.json({ error: 'Viewer nao pode copiar ordens em lote' }, { status: 403 })
  }
  const canViewGlobal = role === 'gestor'

  let canAccessPmpl = canViewGlobal
  if (!canViewGlobal) {
    try {
      const pmplResolution = await resolveCurrentPmplOwner(supabase)
      canAccessPmpl = canAccessPmplTab({
        role,
        loggedAdminId: loggedAdmin.id,
        pmplResolution,
      })
    } catch {
      canAccessPmpl = false
    }
  }

  const parsedRequest = parseOrdersWorkspaceRequest(new URL(request.url).searchParams, canAccessPmpl)
  const adminScope = canViewGlobal ? null : loggedAdmin.id
  const responsavelFilter = canViewGlobal ? parsedRequest.responsavel : null

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

  const rowsFromRpc = (rpcResult.data ?? []) as OrdemNotaAcompanhamento[]

  const rows = canViewGlobal
    ? rowsFromRpc
    : rowsFromRpc.filter((row) => row.responsavel_atual_id === loggedAdmin.id)

  const lastRow = rowsFromRpc.length > 0 ? rowsFromRpc[rowsFromRpc.length - 1] : null
  const nextCursor = rowsFromRpc.length === parsedRequest.limit && lastRow
    ? {
      ordem_detectada_em: lastRow.ordem_detectada_em,
      ordem_id: lastRow.ordem_id,
    }
    : null

  return NextResponse.json({ rows, nextCursor })
}
