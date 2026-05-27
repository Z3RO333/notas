import { NextResponse } from 'next/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { createClient } from '@/lib/supabase/server'
import type { PedidosAdminSummary, PedidosSummaryResponse } from '@/lib/types/pedidos'

type SummaryRpcRow = {
  admin_id: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  em_aberto: number
  encerrado: number
  cancelado: number
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

  const adminScope = currentAdminContext.canViewGlobal ? null : currentAdminContext.adminId

  const { data, error } = await supabase.rpc('listar_pedidos_summary_por_admin', {
    p_admin_scope: adminScope,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const admins: PedidosAdminSummary[] = ((data ?? []) as SummaryRpcRow[]).map((row) => ({
    adminId: row.admin_id,
    nome: row.nome,
    avatar_url: row.avatar_url,
    especialidade: row.especialidade,
    em_aberto: Number(row.em_aberto),
    encerrado: Number(row.encerrado),
    cancelado: Number(row.cancelado),
  }))

  const response: PedidosSummaryResponse = { admins }
  return NextResponse.json(response)
}
