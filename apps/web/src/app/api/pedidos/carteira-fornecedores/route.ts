import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessPedidos } from '@/lib/pedidos/access'
import { buildPedidosContractMeta } from '@/app/api/pedidos/_contract'
import {
  buildCarteiraKpis,
  deriveAvailableAdmins,
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
  pedidos_contratos: { numero: string; ciclo: string | null; admin_id: string | null; admin_nome: string | null; admin_avatar: string | null }[] | null
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

  const [resumoResult, kpisResult] = await Promise.all([
    supabase.rpc('listar_pedidos_carteira_fornecedor_resumo', {
      p_admin_scope: canViewGlobal ? null : currentAdminContext.adminId,
      p_tipo: tipo,
    }),
    supabase.rpc('calcular_kpis_pedidos_workspace', {
      p_admin_scope: canViewGlobal ? null : currentAdminContext.adminId,
      p_admin_filter: null,
      p_ano: null,
      p_mes_extracao: null,
      p_status: null,
      p_q: null,
    }),
  ])

  if (resumoResult.error) {
    console.error('pedidos/carteira resumo:', resumoResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar carteira de pedidos' }, { status: 500 })
  }
  if (kpisResult.error) {
    console.error('pedidos/carteira kpis:', kpisResult.error.message)
    return NextResponse.json({ error: 'Falha ao carregar carteira de pedidos' }, { status: 500 })
  }

  const rows = ((resumoResult.data ?? []) as CarteiraResumoViewRow[]).map(toCarteiraRow)
  const availableAdmins = canViewGlobal
    ? deriveAvailableAdmins(rows).map((admin) => ({
        id: admin.id,
        nome: admin.nome,
        avatar_url: admin.avatarUrl,
      }))
    : []

  const response: PedidosCarteiraResponse = {
    rows,
    kpis: buildCarteiraKpis(rows),
    availableAdmins,
    contract: buildPedidosContractMeta(kpisResult.data),
  }

  return NextResponse.json(response)
}
