import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createAdminClient } from '@/lib/supabase/admin'
import type { FornecedorOrderSearchRow } from '@/lib/types/database'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function normalizeQuery(value: string | null): string {
  return (value ?? '').trim()
}

function hasEnoughSignal(value: string): boolean {
  return value.replace(/[%_\s\\]+/g, '').length >= 3
}

function parseLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return DEFAULT_LIMIT
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function statusFromRpcError(error: { code?: string; message?: string } | null): number {
  if (error?.code === '42501') return 403
  if (error?.code === '22023') return 400
  return 500
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const currentAdminContext = await getCurrentRequestAdminContext({
    allowMaintainerView: true,
  })

  if (!currentAdminContext.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!currentAdminContext.adminId || !currentAdminContext.actualRole) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  if (currentAdminContext.actualRole !== 'admin' && currentAdminContext.actualRole !== 'gestor') {
    return NextResponse.json({ error: 'Sem permissao para localizar fornecedor' }, { status: 403 })
  }

  const url = new URL(request.url)
  const q = normalizeQuery(url.searchParams.get('q'))
  const limit = parseLimit(url.searchParams.get('limit'))

  if (!hasEnoughSignal(q)) {
    return NextResponse.json({ error: 'Informe pelo menos 3 caracteres para buscar fornecedor' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('buscar_ordens_fornecedor_global', {
    p_q: q,
    p_admin_id: currentAdminContext.adminId,
    p_limit: limit,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: statusFromRpcError(error) })
  }

  return NextResponse.json({
    rows: (data ?? []) as FornecedorOrderSearchRow[],
    q,
    limit,
  })
}
