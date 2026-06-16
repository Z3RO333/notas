import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import type { OperacionalSaida } from '@/lib/types/saidas'

export async function GET() {
  const supabase = await createClient()
  const ctx = await getCurrentRequestAdminContext({ supabase, allowMaintainerView: false })

  if (!ctx.email || !ctx.adminId) return NextResponse.json({ saida: null })

  const { data: adminData } = await supabase
    .from('administradores')
    .select('operacional_codigo')
    .eq('id', ctx.adminId)
    .maybeSingle()

  const opCodigo = (adminData as { operacional_codigo?: string | null } | null)?.operacional_codigo
  if (!opCodigo) return NextResponse.json({ saida: null })

  const { data } = await supabase
    .from('operacional_saidas')
    .select(`
      id, operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
      status, data_saida, data_finalizacao, observacao, created_at,
      operacional_saida_ordens(count)
    `)
    .eq('operacional_codigo', opCodigo)
    .eq('status', 'em_rota')
    .order('data_saida', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return NextResponse.json({ saida: null })

  const s = data as Record<string, unknown>
  const ordens = (s.operacional_saida_ordens as { count: number }[] | null) ?? []
  const saida: OperacionalSaida = {
    id: s.id as string,
    operacionalCodigo: s.operacional_codigo as string,
    operacionalNomeSnapshot: s.operacional_nome_snapshot as string,
    criadoPorAdminId: s.criado_por_admin_id as string,
    status: 'em_rota',
    dataSaida: s.data_saida as string,
    dataFinalizacao: null,
    observacao: s.observacao as string | null,
    createdAt: s.created_at as string,
    totalOrdens: ordens[0]?.count ?? 0,
    ordensComResultado: 0,
  }

  return NextResponse.json({ saida })
}
