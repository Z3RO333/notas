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

  const raw = new URL(request.url).searchParams.get('q') ?? ''
  // Strip PostgREST filter metacharacters to prevent filter injection
  const q = raw.replace(/[,()*\\]/g, '').trim()
  if (q.length < 3) return NextResponse.json({ rows: [] })

  const { data, error } = await supabase
    .from('vw_ordens_notas_painel')
    .select('ordem_codigo, numero_nota, unidade, texto_breve, status_ordem_raw, tipo_ordem')
    .or(`ordem_codigo.ilike.%${q}%,numero_nota.ilike.%${q}%,unidade.ilike.%${q}%`)
    .not('ordem_codigo', 'is', null)
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: data ?? [] })
}
