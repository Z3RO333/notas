import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessPedidos } from '@/lib/pedidos/access'
import {
  buildPedidosContractMeta,
  mapPedidosKpis,
  normalizePedidoStatus,
  normalizePedidoStatusEfetivo,
} from '@/app/api/pedidos/_contract'
import type {
  PedidoCompra,
  PedidoCompraStatusEfetivo,
  PedidosWorkspaceMeta,
  PedidosWorkspaceResponse,
} from '@/lib/types/pedidos'

type PedidosWorkspaceRpcRow = PedidoCompra & {
  cursor_data_documento: string
}

const PAGE_SIZE = 100
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const VALID_STATUS: readonly PedidoCompraStatusEfetivo[] = [
  'em_aberto',
  'encerrado',
  'cancelado',
  'indeterminado',
]

function normalizeSearchText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized.slice(0, 120) : null
}

function normalizeStatus(value: string | null | undefined): PedidoCompraStatusEfetivo | 'all' {
  const normalized = (value ?? '').trim()
  return VALID_STATUS.includes(normalized as PedidoCompraStatusEfetivo)
    ? (normalized as PedidoCompraStatusEfetivo)
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
  if (!normalized || normalized === 'all') return null
  return /^\d{4}$/.test(normalized) ? normalized : null
}

function normalizeMes(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === 'all') return null
  return /^\d{6}$/.test(normalized) ? normalized : null
}

function shouldIncludeMeta(value: string | null | undefined, cursorReady: boolean): boolean {
  const normalized = (value ?? '').trim()
  if (normalized === '0' || normalized === 'false') return false
  if (normalized === '1' || normalized === 'true') return true
  return !cursorReady
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toPedidoCompraRow(row: PedidosWorkspaceRpcRow): PedidoCompra {
  const statusEfetivo = normalizePedidoStatusEfetivo(row.status_efetivo ?? row.status)
  const statusCompat = normalizePedidoStatus(row.status)
    ?? (statusEfetivo === 'indeterminado' ? 'em_aberto' : statusEfetivo)

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
    status: statusCompat,
    status_header: row.status_header ?? null,
    status_proc_raw: row.status_proc_raw ?? null,
    status_efetivo: statusEfetivo,
    status_indeterminado: row.status_indeterminado ?? statusEfetivo === 'indeterminado',
    tipo_documento: row.tipo_documento,
    grupo_compradores: row.grupo_compradores ?? '112',
    organizacao_compras: row.organizacao_compras ?? null,
    data_criacao: row.data_criacao ?? null,
    mes_extracao: row.mes_extracao,
    created_at: row.created_at,
    updated_at: row.updated_at,
    nf_referencias: Array.isArray(row.nf_referencias) ? row.nf_referencias : [],
    fornecedor_owner_admin_id: row.fornecedor_owner_admin_id ?? null,
    fornecedor_owner_nome: row.fornecedor_owner_nome ?? null,
    na_carteira_especial: Boolean(row.na_carteira_especial),
    criador_admin_id: row.criador_admin_id ?? null,
    criador_admin_nome: row.criador_admin_nome ?? null,
    responsavel_atual_id: row.administrador_id ?? null,
    responsavel_atual_nome: row.responsavel_atual_nome ?? null,
    itens_total: optionalNumber(row.itens_total),
    itens_ativos: optionalNumber(row.itens_ativos),
    itens_excluidos: optionalNumber(row.itens_excluidos),
    valor_itens_total: optionalNumber(row.valor_itens_total),
    valor_itens_ativos: optionalNumber(row.valor_itens_ativos),
    valor_divergencia: optionalNumber(row.valor_divergencia),
    source_bk_extracao: row.source_bk_extracao ?? null,
    source_data_extracao: row.source_data_extracao ?? null,
    source_last_seen_at: row.source_last_seen_at ?? null,
    source_active: typeof row.source_active === 'boolean' ? row.source_active : undefined,
    scope_quality: row.scope_quality ?? null,
    status_quality: row.status_quality ?? null,
    items_quality: row.items_quality ?? null,
  }
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
        .select('id, nome, avatar_url')
        .eq('ativo', true)
        .eq('recebe_distribuicao', true)
        .order('nome')
    : Promise.resolve({ data: [] as Array<{ id: string; nome: string; avatar_url: string | null }>, error: null })

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
          p_status: status === 'all' ? null : status,
          p_q: q,
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
    console.error('pedidos/workspace rows:', rowsResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar pedidos' }, { status: 500 })
  }
  if (kpisResult.error) {
    console.error('pedidos/workspace kpis:', kpisResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar pedidos' }, { status: 500 })
  }
  if (anosResult.error) {
    console.error('pedidos/workspace anos:', anosResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar pedidos' }, { status: 500 })
  }
  if (mesesResult.error) {
    console.error('pedidos/workspace meses:', mesesResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar pedidos' }, { status: 500 })
  }
  if (adminsResult.error) {
    console.error('pedidos/workspace admins:', adminsResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar pedidos' }, { status: 500 })
  }

  const rowsWithCursor = (rowsResult.data ?? []) as PedidosWorkspaceRpcRow[]
  const hasMore = rowsWithCursor.length > PAGE_SIZE
  const visibleRows = hasMore ? rowsWithCursor.slice(0, PAGE_SIZE) : rowsWithCursor
  const lastVisibleRow = visibleRows[visibleRows.length - 1] ?? null
  const meta: PedidosWorkspaceMeta | undefined = includeMeta
    ? {
        kpis: mapPedidosKpis(kpisResult.data),
        availableAdmins: (adminsResult.data ?? []) as Array<{ id: string; nome: string; avatar_url: string | null }>,
        availableAnos: ((anosResult.data ?? []) as Array<{ ano: string | null }>)
          .map((row) => row.ano)
          .filter((value): value is string => Boolean(value)),
        availableMeses: ((mesesResult.data ?? []) as Array<{ mes_extracao: string | null }>)
          .map((row) => row.mes_extracao)
          .filter((value): value is string => Boolean(value)),
        contract: buildPedidosContractMeta(kpisResult.data),
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
