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
  const q = url.searchParams.get('q')?.trim() ?? ''
  const status = url.searchParams.get('status') ?? 'all'
  const adminId = url.searchParams.get('adminId') ?? 'all'
  const mesExtracao = url.searchParams.get('mesExtracao') ?? null

  // Scope: admin sees only own pedidos; gestor sees all mapped admins
  const adminScope = isGestor ? null : loggedAdmin.id

  // Build base query for rows
  let rowsQuery = supabase
    .from('pedidos_compra')
    .select('*')
    .order('data_documento', { ascending: false })

  if (adminScope) {
    rowsQuery = rowsQuery.eq('administrador_id', adminScope)
  } else if (adminId !== 'all') {
    rowsQuery = rowsQuery.eq('administrador_id', adminId)
  }

  if (status !== 'all') {
    rowsQuery = rowsQuery.eq('status', status)
  }

  if (mesExtracao) {
    rowsQuery = rowsQuery.eq('mes_extracao', mesExtracao)
  }

  if (q) {
    rowsQuery = rowsQuery.ilike('fornecedor', `%${q}%`)
  }

  // Build KPIs query (no filters except scope)
  let kpisQuery = supabase
    .from('pedidos_compra')
    .select('status, valor_liquido_total')

  if (adminScope) {
    kpisQuery = kpisQuery.eq('administrador_id', adminScope)
  } else if (adminId !== 'all') {
    kpisQuery = kpisQuery.eq('administrador_id', adminId)
  }

  if (mesExtracao) {
    kpisQuery = kpisQuery.eq('mes_extracao', mesExtracao)
  }

  // Available admins for gestor filter
  const adminsQuery = isGestor
    ? supabase
        .from('administradores')
        .select('id, nome')
        .eq('ativo', true)
        .eq('recebe_distribuicao', true)
        .order('nome')
    : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null })

  // Available meses
  let mesesQuery = supabase
    .from('pedidos_compra')
    .select('mes_extracao')

  if (adminScope) {
    mesesQuery = mesesQuery.eq('administrador_id', adminScope)
  }

  const [rowsResult, kpisResult, adminsResult, mesesResult] = await Promise.all([
    rowsQuery,
    kpisQuery,
    adminsQuery,
    mesesQuery,
  ])

  if (rowsResult.error) {
    return NextResponse.json({ error: rowsResult.error.message }, { status: 500 })
  }
  if (kpisResult.error) {
    return NextResponse.json({ error: kpisResult.error.message }, { status: 500 })
  }
  if (adminsResult.error) {
    return NextResponse.json({ error: adminsResult.error.message }, { status: 500 })
  }

  const rows = (rowsResult.data ?? []) as PedidoCompra[]

  // Compute KPIs from kpisResult (no text/status filter applied)
  const kpisRows = kpisResult.data ?? []
  const kpis: PedidosKpis = {
    total: kpisRows.length,
    em_aberto: kpisRows.filter((r) => r.status === 'em_aberto').length,
    encerrado: kpisRows.filter((r) => r.status === 'encerrado').length,
    cancelado: kpisRows.filter((r) => r.status === 'cancelado').length,
    valor_total: kpisRows.reduce((sum, r) => sum + (r.valor_liquido_total ?? 0), 0),
  }

  // Deduplicate meses
  const mesesSet = new Set<string>()
  for (const row of mesesResult.data ?? []) {
    if (row.mes_extracao) mesesSet.add(row.mes_extracao)
  }
  const availableMeses = Array.from(mesesSet).sort((a, b) => b.localeCompare(a))

  const response: PedidosWorkspaceResponse = {
    rows,
    kpis,
    availableAdmins: (adminsResult.data ?? []) as { id: string; nome: string }[],
    availableMeses,
  }

  return NextResponse.json(response)
}
