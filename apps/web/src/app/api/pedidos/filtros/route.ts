import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessPedidos } from '@/lib/pedidos/access'
import { buildPedidosContractMeta, mapPedidosKpis } from '@/app/api/pedidos/_contract'
import type { PedidoCompraStatusEfetivo, PedidosFiltrosResponse } from '@/lib/types/pedidos'

const VALID_STATUS: readonly PedidoCompraStatusEfetivo[] = [
  'em_aberto',
  'encerrado',
  'cancelado',
  'indeterminado',
]

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

  const [anosResult, mesesResult, kpisResult] = await Promise.all([
    supabase.rpc('listar_pedidos_workspace_anos', {
      p_admin_scope: adminScope,
      p_admin_filter: null,
    }),
    supabase.rpc('listar_pedidos_workspace_meses', {
      p_admin_scope: adminScope,
      p_admin_filter: null,
      p_ano: anoDocumento,
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

  if (anosResult.error) {
    console.error('pedidos/filtros anos:', anosResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar filtros de pedidos' }, { status: 500 })
  }
  if (mesesResult.error) {
    console.error('pedidos/filtros meses:', mesesResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar filtros de pedidos' }, { status: 500 })
  }
  if (kpisResult.error) {
    console.error('pedidos/filtros kpis:', kpisResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar filtros de pedidos' }, { status: 500 })
  }

  const response: PedidosFiltrosResponse = {
    availableAnos: ((anosResult.data ?? []) as Array<{ ano: string | null }>)
      .map((row) => row.ano)
      .filter((value): value is string => Boolean(value)),
    availableMeses: ((mesesResult.data ?? []) as Array<{ mes_extracao: string | null }>)
      .map((row) => row.mes_extracao)
      .filter((value): value is string => Boolean(value)),
    kpis: mapPedidosKpis(kpisResult.data),
    contract: buildPedidosContractMeta(kpisResult.data),
  }

  return NextResponse.json(response)
}
