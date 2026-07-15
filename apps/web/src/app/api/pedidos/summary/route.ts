import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createClient } from '@/lib/supabase/server'
import type { PedidoCompraStatus, PedidosAdminSummary, PedidosSummaryResponse } from '@/lib/types/pedidos'

type SummaryRpcRow = {
  admin_id: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
}

const VALID_STATUS: readonly PedidoCompraStatus[] = ['em_aberto', 'encerrado', 'cancelado']

function normalizeAno(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return normalized
}

function normalizeMes(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return normalized
}

function normalizeStatus(value: string | null | undefined): PedidoCompraStatus | null {
  const normalized = (value ?? '').trim()
  return VALID_STATUS.includes(normalized as PedidoCompraStatus) ? (normalized as PedidoCompraStatus) : null
}

function normalizeSearchText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const currentAdminContext = await getCurrentRequestAdminContext({
    allowMaintainerView: true,
  })

  if (!currentAdminContext.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!currentAdminContext.adminId || !currentAdminContext.role) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const url = new URL(request.url)
  const anoExtracao = normalizeAno(url.searchParams.get('ano'))
  const mesExtracao = normalizeMes(url.searchParams.get('mes'))
  const status = normalizeStatus(url.searchParams.get('status'))
  const q = normalizeSearchText(url.searchParams.get('q'))
  const adminScope = currentAdminContext.canViewGlobal ? null : currentAdminContext.adminId

  const { data, error } = await supabase.rpc('listar_pedidos_summary_por_admin', {
    p_admin_scope: adminScope,
    p_ano: anoExtracao,
    p_mes_extracao: mesExtracao,
    p_status: status,
    p_q: q,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const admins: PedidosAdminSummary[] = ((data ?? []) as SummaryRpcRow[]).map((row) => ({
    adminId: row.admin_id,
    nome: row.nome,
    avatar_url: row.avatar_url,
    especialidade: row.especialidade,
    em_aberto: Number(row.em_aberto),
    encerrado: Number(row.encerrado),
    cancelado: Number(row.cancelado),
    valor_total: Number(row.valor_total),
  }))

  const response: PedidosSummaryResponse = { admins }
  return NextResponse.json(response)
}
