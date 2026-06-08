import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createClient } from '@/lib/supabase/server'
import type {
  PedidosCarteiraFornecedorRow,
  PedidosCarteiraKpis,
  PedidosCarteiraResponse,
} from '@/lib/types/pedidos'

type CarteiraResumoViewRow = {
  fornecedor_codigo: string
  fornecedor_nome: string
  admin_id: string
  admin_nome: string | null
  admin_avatar: string | null
  qtd_pedidos: number
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
}

function toCarteiraRow(row: CarteiraResumoViewRow): PedidosCarteiraFornecedorRow {
  return {
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedorNome: row.fornecedor_nome,
    adminId: row.admin_id,
    adminNome: row.admin_nome,
    adminAvatar: row.admin_avatar,
    qtdPedidos: Number(row.qtd_pedidos ?? 0),
    emAberto: Number(row.em_aberto ?? 0),
    encerrado: Number(row.encerrado ?? 0),
    cancelado: Number(row.cancelado ?? 0),
    valorTotal: Number(row.valor_total ?? 0),
  }
}

function buildKpis(rows: PedidosCarteiraFornecedorRow[]): PedidosCarteiraKpis {
  return rows.reduce<PedidosCarteiraKpis>(
    (acc, row) => ({
      totalFornecedores: acc.totalFornecedores + 1,
      totalPedidos: acc.totalPedidos + row.qtdPedidos,
      valorTotal: acc.valorTotal + row.valorTotal,
      emAberto: acc.emAberto + row.emAberto,
      encerrado: acc.encerrado + row.encerrado,
      cancelado: acc.cancelado + row.cancelado,
    }),
    { totalFornecedores: 0, totalPedidos: 0, valorTotal: 0, emAberto: 0, encerrado: 0, cancelado: 0 },
  )
}

export async function GET() {
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

  const [resumoResult, adminsResult] = await Promise.all([
    supabase
      .from('vw_pedidos_carteira_fornecedor_resumo')
      .select('fornecedor_codigo, fornecedor_nome, admin_id, admin_nome, admin_avatar, qtd_pedidos, em_aberto, encerrado, cancelado, valor_total'),
    supabase
      .from('administradores')
      .select('id, nome, avatar_url')
      .eq('role', 'admin')
      .eq('especialidade', 'geral')
      .eq('ativo', true)
      .order('nome'),
  ])

  if (resumoResult.error) {
    return NextResponse.json({ error: resumoResult.error.message }, { status: 500 })
  }
  if (adminsResult.error) {
    return NextResponse.json({ error: adminsResult.error.message }, { status: 500 })
  }

  const allRows = ((resumoResult.data ?? []) as CarteiraResumoViewRow[]).map(toCarteiraRow)
  const rows = canViewGlobal
    ? allRows
    : allRows.filter((row) => row.adminId === currentAdminContext.adminId)

  const response: PedidosCarteiraResponse = {
    rows,
    kpis: buildKpis(rows),
    availableAdmins: (adminsResult.data ?? []) as Array<{ id: string; nome: string; avatar_url: string | null }>,
  }

  return NextResponse.json(response)
}
