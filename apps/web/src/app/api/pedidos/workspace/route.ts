import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { resolveMaintainerViewFromCookie } from '@/lib/auth/shared'
import { MVIEW_COOKIE_NAME } from '@/lib/auth/maintainer-view'
import { createClient } from '@/lib/supabase/server'
import type {
  PedidoCompra,
  PedidosKpis,
  PedidosWorkspaceResponse,
} from '@/lib/types/pedidos'
import type { UserRole } from '@/lib/types/database'

type SupplierDimensionRow = {
  codigo: string | null
  nome: string | null
}

type QueryError = {
  message: string
}

const PAGE_SIZE = 1000

function normalizeSupplierCode(value: string | null | undefined): string | null {
  const rawValue = (value ?? '').trim()
  if (!rawValue) return null

  const normalized = rawValue.replace(/^0+/, '')
  return normalized || null
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError | null }>,
): Promise<{ data: T[]; error: null } | { data: null; error: QueryError }> {
  const allRows: T[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await fetchPage(from, to)
    if (error) {
      return { data: null, error }
    }

    const pageRows = data ?? []
    allRows.push(...pageRows)

    if (pageRows.length < PAGE_SIZE) {
      break
    }
  }

  return { data: allRows, error: null }
}

function buildSupplierNameMap(
  fornecedores: SupplierDimensionRow[],
  operacionais: SupplierDimensionRow[],
): Map<string, string> {
  const map = new Map<string, string>()

  for (const row of operacionais) {
    const code = normalizeSupplierCode(row.codigo)
    const name = row.nome?.trim()
    if (code && name && !map.has(code)) {
      map.set(code, name)
    }
  }

  for (const row of fornecedores) {
    const code = normalizeSupplierCode(row.codigo)
    const name = row.nome?.trim()
    if (code && name) {
      map.set(code, name)
    }
  }

  return map
}

function enrichPedidos(
  rows: PedidoCompra[],
  supplierNameByCode: Map<string, string>,
): PedidoCompra[] {
  return rows.map((row) => {
    const supplierCode = normalizeSupplierCode(row.fornecedor)
    return {
      ...row,
      fornecedor: supplierCode,
      fornecedor_codigo: supplierCode,
      fornecedor_nome: supplierCode ? supplierNameByCode.get(supplierCode) ?? null : null,
    }
  })
}

function matchesSearch(row: PedidoCompra, normalizedQuery: string): boolean {
  const haystack = [
    row.documento_compras,
    row.fornecedor_nome,
    row.fornecedor_codigo,
    row.fornecedor,
    row.tipo_documento,
    row.sap_codigo,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(normalizedQuery)
}

function computeKpis(rows: PedidoCompra[]): PedidosKpis {
  return rows.reduce<PedidosKpis>(
    (acc, row) => {
      acc.total += 1
      acc.valor_total += row.valor_liquido_total ?? 0

      if (row.status === 'em_aberto') acc.em_aberto += 1
      if (row.status === 'encerrado') acc.encerrado += 1
      if (row.status === 'cancelado') acc.cancelado += 1

      return acc
    },
    {
      total: 0,
      em_aberto: 0,
      encerrado: 0,
      cancelado: 0,
      valor_total: 0,
    },
  )
}

function filterByMes(rows: PedidoCompra[], mesExtracao: string | null): PedidoCompra[] {
  if (!mesExtracao) return rows
  return rows.filter((row) => row.mes_extracao === mesExtracao)
}

function filterByStatus(rows: PedidoCompra[], status: string): PedidoCompra[] {
  if (status === 'all') return rows
  return rows.filter((row) => row.status === status)
}

function collectAvailableMeses(rows: PedidoCompra[]): string[] {
  return Array.from(
    new Set(rows.map((row) => row.mes_extracao).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a))
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: loggedAdminError } = await supabase
    .from('administradores')
    .select('id, nome, role')
    .eq('email', user.email)
    .single()

  if (loggedAdminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const cookieStore = await cookies()
  const mviewCookie = cookieStore.get(MVIEW_COOKIE_NAME)?.value
  const secret = process.env.MAINTAINER_SESSION_SECRET
  const actualRole = loggedAdmin.role as UserRole
  const role = resolveMaintainerViewFromCookie(mviewCookie, user.email, secret) ?? actualRole
  const isGestor = role === 'gestor' || role === 'viewer'

  const url = new URL(request.url)
  const q = normalizeSearchText(url.searchParams.get('q'))
  const status = url.searchParams.get('status') ?? 'all'
  const adminId = url.searchParams.get('adminId') ?? 'all'
  const mesExtracao = url.searchParams.get('mesExtracao') ?? null

  const adminScope = isGestor ? null : loggedAdmin.id

  const scopedRowsPromise = fetchAllPages<PedidoCompra>((from, to) => {
    let query = supabase
      .from('pedidos_compra')
      .select('*')
      .order('data_documento', { ascending: false })
      .order('documento_compras', { ascending: false })
      .range(from, to)

    if (adminScope) {
      query = query.eq('administrador_id', adminScope)
    } else if (adminId !== 'all') {
      query = query.eq('administrador_id', adminId)
    }

    return query
  })

  const adminsPromise = isGestor
    ? supabase
        .from('administradores')
        .select('id, nome')
        .eq('ativo', true)
        .eq('recebe_distribuicao', true)
        .order('nome')
    : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null })

  const [scopedRowsResult, fornecedoresResult, operacionaisResult, adminsResult] = await Promise.all([
    scopedRowsPromise,
    supabase.from('dim_fornecedores').select('codigo, nome').range(0, 4999),
    supabase.from('dim_operacionais').select('codigo, nome').range(0, 4999),
    adminsPromise,
  ])

  if (scopedRowsResult.error) {
    return NextResponse.json({ error: scopedRowsResult.error.message }, { status: 500 })
  }
  if (fornecedoresResult.error) {
    return NextResponse.json({ error: fornecedoresResult.error.message }, { status: 500 })
  }
  if (operacionaisResult.error) {
    return NextResponse.json({ error: operacionaisResult.error.message }, { status: 500 })
  }
  if (adminsResult.error) {
    return NextResponse.json({ error: adminsResult.error.message }, { status: 500 })
  }

  const supplierNameByCode = buildSupplierNameMap(
    (fornecedoresResult.data ?? []) as SupplierDimensionRow[],
    (operacionaisResult.data ?? []) as SupplierDimensionRow[],
  )

  const scopedAllMonths = enrichPedidos(scopedRowsResult.data, supplierNameByCode)
  const availableMeses = collectAvailableMeses(scopedAllMonths)

  const rowsInSelectedMonth = filterByMes(scopedAllMonths, mesExtracao)
  const kpis = computeKpis(rowsInSelectedMonth)

  const rowsByStatus = filterByStatus(rowsInSelectedMonth, status)
  const rows = q
    ? rowsByStatus.filter((row) => matchesSearch(row, q))
    : rowsByStatus

  const response: PedidosWorkspaceResponse = {
    rows,
    kpis,
    availableAdmins: (adminsResult.data ?? []) as { id: string; nome: string }[],
    availableMeses,
  }

  return NextResponse.json(response)
}
