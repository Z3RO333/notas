import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createClient } from '@/lib/supabase/server'
import type { PedidoCompraStatus, PedidosFiltrosResponse, PedidosKpis } from '@/lib/types/pedidos'

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

function mapKpis(value: Partial<PedidosKpis> | null | undefined): PedidosKpis {
  return {
    total: Number(value?.total ?? 0),
    em_aberto: Number(value?.em_aberto ?? 0),
    encerrado: Number(value?.encerrado ?? 0),
    cancelado: Number(value?.cancelado ?? 0),
    valor_total: Number(value?.valor_total ?? 0),
  }
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
  const anoExtracao = normalizeAno(url.searchParams.get('ano'))
  const mesExtracao = normalizeMes(url.searchParams.get('mes'))
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
      p_ano: anoExtracao,
    }),
    supabase.rpc('calcular_kpis_pedidos_workspace', {
      p_admin_scope: adminScope,
      p_admin_filter: null,
      p_ano: anoExtracao,
      p_mes_extracao: mesExtracao,
      p_status: status,
      p_q: q,
    }),
  ])

  if (anosResult.error) {
    return NextResponse.json({ error: anosResult.error.message }, { status: 500 })
  }
  if (mesesResult.error) {
    return NextResponse.json({ error: mesesResult.error.message }, { status: 500 })
  }
  if (kpisResult.error) {
    return NextResponse.json({ error: kpisResult.error.message }, { status: 500 })
  }

  const response: PedidosFiltrosResponse = {
    availableAnos: ((anosResult.data ?? []) as Array<{ ano: string | null }>)
      .map((row) => row.ano)
      .filter((value): value is string => Boolean(value)),
    availableMeses: ((mesesResult.data ?? []) as Array<{ mes_extracao: string | null }>)
      .map((row) => row.mes_extracao)
      .filter((value): value is string => Boolean(value)),
    kpis: mapKpis((kpisResult.data ?? null) as Partial<PedidosKpis> | null),
  }

  return NextResponse.json(response)
}
