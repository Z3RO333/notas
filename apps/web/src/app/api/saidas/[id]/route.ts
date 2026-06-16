import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import type { SaidaDetalhe, SaidaOrdem } from '@/lib/types/saidas'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const ctx = await getCurrentRequestAdminContext({ supabase, allowMaintainerView: true })

  if (!ctx.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!ctx.adminId) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { data: saida, error } = await supabase
    .from('operacional_saidas')
    .select(`
      id, operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
      status, data_saida, data_finalizacao, observacao, created_at,
      operacional_saida_ordens (
        id, saida_id, ordem_codigo, numero_nota, unidade, texto_breve,
        status_ordem_raw_snapshot, tipo_ordem, resultado,
        observacao_retorno, data_resultado, created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!saida) return NextResponse.json({ error: 'Saída não encontrada' }, { status: 404 })

  // Técnico só acessa sua própria saída
  if (ctx.role === 'operacional') {
    const { data: adminData } = await supabase
      .from('administradores')
      .select('operacional_codigo')
      .eq('id', ctx.adminId)
      .maybeSingle()
    const opCodigo = (adminData as { operacional_codigo?: string | null } | null)?.operacional_codigo
    if (opCodigo !== (saida as Record<string, unknown>).operacional_codigo) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }
  }

  const s = saida as Record<string, unknown>
  const ordens = (s.operacional_saida_ordens as Record<string, unknown>[]) ?? []

  const result: SaidaDetalhe = {
    id: s.id as string,
    operacionalCodigo: s.operacional_codigo as string,
    operacionalNomeSnapshot: s.operacional_nome_snapshot as string,
    criadoPorAdminId: s.criado_por_admin_id as string,
    status: s.status as SaidaDetalhe['status'],
    dataSaida: s.data_saida as string,
    dataFinalizacao: s.data_finalizacao as string | null,
    observacao: s.observacao as string | null,
    createdAt: s.created_at as string,
    totalOrdens: ordens.length,
    ordensComResultado: ordens.filter((o) => o.resultado != null).length,
    ordens: ordens.map((o): SaidaOrdem => ({
      id: o.id as string,
      saidaId: o.saida_id as string,
      ordemCodigo: o.ordem_codigo as string,
      numeroNota: o.numero_nota as string | null,
      unidade: o.unidade as string | null,
      textoBreve: o.texto_breve as string | null,
      statusOrdemRawSnapshot: o.status_ordem_raw_snapshot as string | null,
      tipoOrdem: o.tipo_ordem as string | null,
      resultado: o.resultado as SaidaOrdem['resultado'],
      observacaoRetorno: o.observacao_retorno as string | null,
      dataResultado: o.data_resultado as string | null,
      createdAt: o.created_at as string,
    })),
  }

  return NextResponse.json(result)
}
