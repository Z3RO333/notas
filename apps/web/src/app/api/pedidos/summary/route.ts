import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessPedidos } from '@/lib/pedidos/access'
import { buildPedidosContractMeta } from '@/app/api/pedidos/_contract'
import type {
  PedidoCompraStatusEfetivo,
  PedidosAdminSummary,
  PedidosSummaryResponse,
} from '@/lib/types/pedidos'

type SummaryRpcRow = {
  admin_id: string | null
  nome: string
  avatar_url: string | null
  especialidade: string | null
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
  status_indeterminado?: number
  valor_em_aberto?: number
}

const VALID_STATUS: readonly PedidoCompraStatusEfetivo[] = [
  'em_aberto',
  'encerrado',
  'cancelado',
  'indeterminado',
]
const UNASSIGNED_ADMIN_ID = '00000000-0000-0000-0000-000000000000'

function normalizeAno(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return /^\d{4}$/.test(normalized) ? normalized : null
}

function normalizeMes(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return /^\d{6}$/.test(normalized) ? normalized : null
}

function normalizeStatus(value: string | null | undefined): PedidoCompraStatusEfetivo | null {
  const normalized = (value ?? '').trim()
  return VALID_STATUS.includes(normalized as PedidoCompraStatusEfetivo)
    ? (normalized as PedidoCompraStatusEfetivo)
    : null
}

function normalizeSearchText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized.slice(0, 120) : null
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const currentAdminContext = await getCurrentRequestAdminContext({
    allowMaintainerView: true,
  })

  if (!currentAdminContext.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!currentAdminContext.adminId || !canAccessPedidos(currentAdminContext.role)) {
    return NextResponse.json({ error: 'Sem permissao para acessar pedidos' }, { status: 403 })
  }

  const url = new URL(request.url)
  const anoDocumento = normalizeAno(url.searchParams.get('ano'))
  const mesDocumento = normalizeMes(url.searchParams.get('mes'))
  const status = normalizeStatus(url.searchParams.get('status'))
  const q = normalizeSearchText(url.searchParams.get('q'))
  const adminScope = currentAdminContext.canViewGlobal ? null : currentAdminContext.adminId

  const [summaryResult, kpisResult] = await Promise.all([
    supabase.rpc('listar_pedidos_summary_por_admin', {
      p_admin_scope: adminScope,
      p_ano: anoDocumento,
      p_mes_extracao: mesDocumento,
      p_status: status,
      p_q: q,
    }),
    supabase.rpc('calcular_kpis_pedidos_workspace', {
      p_admin_scope: adminScope,
      p_admin_filter: null,
      p_ano: anoDocumento,
      p_mes_extracao: mesDocumento,
      p_status: status,
      p_q: q,
    }),
  ])

  if (summaryResult.error) {
    console.error('pedidos/summary rows:', summaryResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar resumo de pedidos' }, { status: 500 })
  }
  if (kpisResult.error) {
    console.error('pedidos/summary kpis:', kpisResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar resumo de pedidos' }, { status: 500 })
  }

  const admins: PedidosAdminSummary[] = ((summaryResult.data ?? []) as SummaryRpcRow[]).map((row) => ({
    adminId: row.admin_id ?? UNASSIGNED_ADMIN_ID,
    nome: row.nome,
    avatar_url: row.avatar_url,
    especialidade: row.especialidade,
    em_aberto: Number(row.em_aberto),
    encerrado: Number(row.encerrado),
    cancelado: Number(row.cancelado),
    valor_total: Number(row.valor_total),
    indeterminado: Number(row.status_indeterminado ?? 0),
    valor_em_aberto: Number(row.valor_em_aberto ?? 0),
    responsavelAtualId: row.admin_id,
  }))

  const response: PedidosSummaryResponse = {
    admins,
    contract: buildPedidosContractMeta(kpisResult.data),
  }
  return NextResponse.json(response)
}
