import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createClient } from '@/lib/supabase/server'
import type {
  PedidoCompra,
  PedidoCompraStatus,
  PedidosKpis,
  PedidosWorkspaceMeta,
  PedidosWorkspaceResponse,
} from '@/lib/types/pedidos'

type PedidosWorkspaceRpcRow = PedidoCompra & {
  cursor_data_documento: string
}

const PAGE_SIZE = 100
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const VALID_STATUS: readonly PedidoCompraStatus[] = ['em_aberto', 'encerrado', 'cancelado']

function normalizeSearchText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeStatus(value: string | null | undefined): PedidoCompraStatus | 'all' {
  const normalized = (value ?? '').trim()
  return VALID_STATUS.includes(normalized as PedidoCompraStatus)
    ? (normalized as PedidoCompraStatus)
    : 'all'
}

function normalizeUuid(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return UUID_REGEX.test(normalized) ? normalized : null
}

function normalizeCursorDate(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return DATE_REGEX.test(normalized) ? normalized : null
}

function normalizeAno(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (normalized === 'all') return null
  return normalized || '2026'
}

function normalizeMes(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return normalized
}

function shouldIncludeMeta(value: string | null | undefined, cursorReady: boolean): boolean {
  const normalized = (value ?? '').trim()
  if (normalized === '0' || normalized === 'false') return false
  if (normalized === '1' || normalized === 'true') return true
  return !cursorReady
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

function toPedidoCompraRow(row: PedidosWorkspaceRpcRow): PedidoCompra {
  return {
    id: row.id,
    documento_compras: row.documento_compras,
    administrador_id: row.administrador_id,
    sap_codigo: row.sap_codigo,
    fornecedor: row.fornecedor,
    fornecedor_codigo: row.fornecedor_codigo,
    fornecedor_nome: row.fornecedor_nome,
    data_documento: row.data_documento,
    valor_liquido_total: row.valor_liquido_total,
    status: row.status,
    tipo_documento: row.tipo_documento,
    mes_extracao: row.mes_extracao,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

  const canViewGlobal = currentAdminContext.canViewGlobal

  const url = new URL(request.url)
  const q = normalizeSearchText(url.searchParams.get('q'))
  const status = normalizeStatus(url.searchParams.get('status'))
  const anoExtracao = normalizeAno(url.searchParams.get('ano'))
  const mesExtracao = normalizeMes(url.searchParams.get('mes') ?? url.searchParams.get('mesExtracao'))
  const adminScope = canViewGlobal ? null : currentAdminContext.adminId
  const adminFilter = adminScope ? null : normalizeUuid(url.searchParams.get('adminId'))
  const cursorDate = normalizeCursorDate(url.searchParams.get('cursorDate'))
  const cursorId = normalizeUuid(url.searchParams.get('cursorId'))
  const cursorReady = cursorDate !== null && cursorId !== null
  const includeMeta = shouldIncludeMeta(url.searchParams.get('includeMeta'), cursorReady)

  const adminsPromise = includeMeta && canViewGlobal
    ? supabase
        .from('administradores')
        .select('id, nome')
        .eq('ativo', true)
        .eq('recebe_distribuicao', true)
        .order('nome')
    : Promise.resolve({ data: [] as Array<{ id: string; nome: string }>, error: null })

  const [rowsResult, kpisResult, anosResult, mesesResult, adminsResult] = await Promise.all([
    supabase.rpc('buscar_pedidos_workspace', {
      p_admin_scope: adminScope,
      p_admin_filter: adminFilter,
      p_status: status === 'all' ? null : status,
      p_ano: anoExtracao,
      p_mes_extracao: mesExtracao,
      p_q: q,
      p_cursor_data_documento: cursorReady ? cursorDate : null,
      p_cursor_id: cursorReady ? cursorId : null,
      p_limit: PAGE_SIZE + 1,
    }),
    includeMeta
      ? supabase.rpc('calcular_kpis_pedidos_workspace', {
          p_admin_scope: adminScope,
          p_admin_filter: adminFilter,
          p_ano: anoExtracao,
          p_mes_extracao: mesExtracao,
        })
      : Promise.resolve({ data: null, error: null }),
    includeMeta
      ? supabase.rpc('listar_pedidos_workspace_anos', {
          p_admin_scope: adminScope,
          p_admin_filter: adminFilter,
        })
      : Promise.resolve({ data: [], error: null }),
    includeMeta
      ? supabase.rpc('listar_pedidos_workspace_meses', {
          p_admin_scope: adminScope,
          p_admin_filter: adminFilter,
          p_ano: anoExtracao,
        })
      : Promise.resolve({ data: [], error: null }),
    adminsPromise,
  ])

  if (rowsResult.error) {
    return NextResponse.json({ error: rowsResult.error.message }, { status: 500 })
  }
  if (kpisResult.error) {
    return NextResponse.json({ error: kpisResult.error.message }, { status: 500 })
  }
  if (anosResult.error) {
    return NextResponse.json({ error: anosResult.error.message }, { status: 500 })
  }
  if (mesesResult.error) {
    return NextResponse.json({ error: mesesResult.error.message }, { status: 500 })
  }
  if (adminsResult.error) {
    return NextResponse.json({ error: adminsResult.error.message }, { status: 500 })
  }

  const rowsWithCursor = (rowsResult.data ?? []) as PedidosWorkspaceRpcRow[]
  const hasMore = rowsWithCursor.length > PAGE_SIZE
  const visibleRows = hasMore ? rowsWithCursor.slice(0, PAGE_SIZE) : rowsWithCursor
  const lastVisibleRow = visibleRows[visibleRows.length - 1] ?? null
  const meta: PedidosWorkspaceMeta | undefined = includeMeta
    ? {
        kpis: mapKpis((kpisResult.data ?? null) as Partial<PedidosKpis> | null),
        availableAdmins: (adminsResult.data ?? []) as Array<{ id: string; nome: string }>,
        availableAnos: ((anosResult.data ?? []) as Array<{ ano: string | null }>)
          .map((row) => row.ano)
          .filter((value): value is string => Boolean(value)),
        availableMeses: ((mesesResult.data ?? []) as Array<{ mes_extracao: string | null }>)
          .map((row) => row.mes_extracao)
          .filter((value): value is string => Boolean(value)),
      }
    : undefined

  const response: PedidosWorkspaceResponse = {
    rows: visibleRows.map(toPedidoCompraRow),
    nextCursor: hasMore && lastVisibleRow
      ? {
          cursorDate: lastVisibleRow.cursor_data_documento,
          cursorId: lastVisibleRow.id,
        }
      : null,
    meta,
  }

  return NextResponse.json(response)
}
