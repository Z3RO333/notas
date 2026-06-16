import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'

export async function GET(request: Request) {
  const supabase = await createClient()
  const ctx = await getCurrentRequestAdminContext({ supabase, allowMaintainerView: true })

  if (!ctx.email || !ctx.adminId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (ctx.role !== 'admin' && ctx.role !== 'gestor') {
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 })
  }

  const q = new URL(request.url).searchParams.get('q') ?? ''
  if (q.trim().length < 3) return NextResponse.json({ rows: [] })

  const { data, error } = await supabase
    .from('vw_ordens_notas_painel')
    .select('ordem_codigo, numero_nota, unidade, status_ordem_raw, tipo_ordem')
    .or(`ordem_codigo.ilike.%${q}%,numero_nota.ilike.%${q}%,unidade.ilike.%${q}%`)
    .not('ordem_codigo', 'is', null)
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For texto_breve, we need to join with ordens_manutencao_referencia
  // Since it's not in the view, we'll fetch it separately or note that it's not available
  const rows = (data ?? []).map((row) => ({
    ordem_codigo: row.ordem_codigo,
    numero_nota: row.numero_nota,
    unidade: row.unidade,
    texto_breve: null, // Will be populated from reference table
    status_ordem_raw: row.status_ordem_raw,
    tipo_ordem: row.tipo_ordem,
  }))

  // Get texto_breve from ordens_manutencao_referencia for each ordem_codigo
  if (rows.length > 0) {
    const ordemCodigos = rows.map((r) => r.ordem_codigo)
    const { data: refData } = await supabase
      .from('ordens_manutencao_referencia')
      .select('ordem_codigo_original, texto_breve')
      .in('ordem_codigo_original', ordemCodigos)

    if (refData) {
      const refMap = new Map(refData.map((r) => [r.ordem_codigo_original, r.texto_breve]))
      rows.forEach((r) => {
        r.texto_breve = refMap.get(r.ordem_codigo) ?? null
      })
    }
  }

  return NextResponse.json({ rows })
}
