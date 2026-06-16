import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createClient } from '@/lib/supabase/server'
import {
  buildCarteiraKpis,
  deriveAvailableAdmins,
  filterCarteiraRowsByTipo,
  isValidCarteiraTipo,
} from '@/lib/pedidos/carteira-helpers'
import type {
  PedidosCarteiraFornecedorRow,
  PedidosCarteiraResponse,
} from '@/lib/types/pedidos'

type CarteiraResumoViewRow = {
  fornecedor_codigo: string
  fornecedor_nome: string
  tipo_carteira: string
  admin_id: string
  admin_nome: string | null
  admin_avatar: string | null
  qtd_pedidos: number
  em_aberto: number
  encerrado: number
  cancelado: number
  valor_total: number
  documentos_compras: string[] | null
  pedidos_contratos: { numero: string; admin_id: string | null; admin_nome: string | null; admin_avatar: string | null }[] | null
}

function toCarteiraRow(row: CarteiraResumoViewRow): PedidosCarteiraFornecedorRow {
  return {
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedorNome: row.fornecedor_nome,
    tipoCarteira: row.tipo_carteira === 'preventiva_anual' ? 'preventiva_anual' : 'corretiva',
    adminId: row.admin_id,
    adminNome: row.admin_nome,
    adminAvatar: row.admin_avatar,
    qtdPedidos: Number(row.qtd_pedidos ?? 0),
    emAberto: Number(row.em_aberto ?? 0),
    encerrado: Number(row.encerrado ?? 0),
    cancelado: Number(row.cancelado ?? 0),
    valorTotal: Number(row.valor_total ?? 0),
    documentosCompras: row.documentos_compras ?? [],
    pedidosContratos: row.pedidos_contratos ?? [],
  }
}

export async function GET(request: Request) {
  const tipo = new URL(request.url).searchParams.get('tipo')

  if (!isValidCarteiraTipo(tipo)) {
    return NextResponse.json(
      { error: "Parâmetro 'tipo' inválido. Use 'corretiva' ou 'preventiva_anual'." },
      { status: 400 }
    )
  }

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

  const resumoResult = await supabase
    .from('vw_pedidos_carteira_fornecedor_resumo')
    .select(
      'fornecedor_codigo, fornecedor_nome, tipo_carteira, admin_id, admin_nome, admin_avatar, qtd_pedidos, em_aberto, encerrado, cancelado, valor_total, documentos_compras, pedidos_contratos'
    )

  if (resumoResult.error) {
    return NextResponse.json({ error: resumoResult.error.message }, { status: 500 })
  }

  const allRows = ((resumoResult.data ?? []) as CarteiraResumoViewRow[]).map(toCarteiraRow)
  const rowsForTipo = filterCarteiraRowsByTipo(allRows, tipo)

  const availableAdmins = deriveAvailableAdmins(rowsForTipo).map((admin) => ({
    id: admin.id,
    nome: admin.nome,
    avatar_url: admin.avatarUrl,
  }))

  const rows = canViewGlobal
    ? rowsForTipo
    : rowsForTipo.filter((row) => row.adminId === currentAdminContext.adminId)

  const response: PedidosCarteiraResponse = {
    rows,
    kpis: buildCarteiraKpis(rows),
    availableAdmins,
  }

  return NextResponse.json(response)
}
