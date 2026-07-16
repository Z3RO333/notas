import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import type { OperacionalSaida } from '@/lib/types/saidas'

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const ctx = await getCurrentRequestAdminContext({ allowMaintainerView: true })

  if (!ctx.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!ctx.adminId || (ctx.role !== 'admin' && ctx.role !== 'gestor')) {
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 })
  }

  const url = new URL(request.url)
  const operacionalCodigo = url.searchParams.get('operacional_codigo')
  const status = url.searchParams.get('status')

  let query = supabase
    .from('operacional_saidas')
    .select(`
      id, operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
      status, data_saida, data_finalizacao, observacao, created_at,
      operacional_saida_ordens(count)
    `)
    .order('data_saida', { ascending: false })

  if (operacionalCodigo) query = query.eq('operacional_codigo', operacionalCodigo)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: OperacionalSaida[] = (data ?? []).map((r: Record<string, unknown>) => {
    const ordens = (r.operacional_saida_ordens as { count: number }[] | null) ?? []
    return {
      id: r.id as string,
      operacionalCodigo: r.operacional_codigo as string,
      operacionalNomeSnapshot: r.operacional_nome_snapshot as string,
      criadoPorAdminId: r.criado_por_admin_id as string,
      status: r.status as OperacionalSaida['status'],
      dataSaida: r.data_saida as string,
      dataFinalizacao: r.data_finalizacao as string | null,
      observacao: r.observacao as string | null,
      createdAt: r.created_at as string,
      totalOrdens: ordens[0]?.count ?? 0,
    }
  })

  return NextResponse.json({ rows })
}
