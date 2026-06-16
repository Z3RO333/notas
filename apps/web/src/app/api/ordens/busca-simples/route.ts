import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'

type OrdemBuscaRow = {
  ordem_codigo: string | null
  numero_nota: string | null
  unidade: string | null
  descricao: string | null
  status_ordem_raw: string | null
  tipo_ordem: string | null
}

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
    .select('ordem_codigo, numero_nota, unidade, descricao, status_ordem_raw, tipo_ordem')
    .or(`ordem_codigo.ilike.%${q}%,numero_nota.ilike.%${q}%,unidade.ilike.%${q}%,descricao.ilike.%${q}%`)
    .not('ordem_codigo', 'is', null)
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = ((data ?? []) as OrdemBuscaRow[])
    .filter((row): row is OrdemBuscaRow & { ordem_codigo: string } => Boolean(row.ordem_codigo))
    .map((row) => ({
      ordem_codigo: row.ordem_codigo,
      numero_nota: row.numero_nota,
      unidade: row.unidade,
      texto_breve: row.descricao,
      status_ordem_raw: row.status_ordem_raw,
      tipo_ordem: row.tipo_ordem,
    }))

  return NextResponse.json({ rows })
}
