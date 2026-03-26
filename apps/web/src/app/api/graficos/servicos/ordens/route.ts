import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callGestaoBaseRpc } from '@/lib/graficos/gestao-base-rpc'
import type { TipoUnidade, UserRole } from '@/lib/types/database'

type GestaoBaseRow = {
  ordem_id: string
  ordem_codigo: string | null
  tipo_ordem: string | null
  competencia_data: string | null
  ano: number
  mes: number
  nome_loja: string | null
  tipo_unidade: string | null
  texto_breve: string | null
  status_ordem_raw: string | null
  nota_referencia: string | null
}

function normalizeText(value: string | null): string {
  return (value ?? '').trim()
}

function asPositiveInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function isTipoUnidade(value: string | null): value is TipoUnidade {
  return value === 'LOJA' || value === 'FARMA' || value === 'CD'
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: loggedAdminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (loggedAdminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const role = loggedAdmin.role as UserRole
  if (role !== 'admin' && role !== 'gestor') {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const servico = normalizeText(searchParams.get('servico'))
  const tipoUnidadeRaw = normalizeText(searchParams.get('tipo_unidade'))
  const ano = asPositiveInt(searchParams.get('ano'))
  const mes = asPositiveInt(searchParams.get('mes'))
  const limit = asPositiveInt(searchParams.get('limit')) ?? 200
  const tipoOrdem = normalizeText(searchParams.get('tipo_ordem')) || null

  if (!servico) {
    return NextResponse.json({ error: 'Servico obrigatorio' }, { status: 400 })
  }

  if (!isTipoUnidade(tipoUnidadeRaw)) {
    return NextResponse.json({ error: 'Tipo de unidade invalido' }, { status: 400 })
  }

  const rpcResult = await callGestaoBaseRpc(supabase, {
    p_ano: ano,
    p_mes: mes,
    p_tipo_ordem: tipoOrdem,
    p_texto_breve: servico,
    p_tipo_unidade: tipoUnidadeRaw,
    p_limit: limit,
  })

  if (rpcResult.error) {
    return NextResponse.json({ error: rpcResult.error.message }, { status: 500 })
  }

  const rows = (rpcResult.data ?? []) as GestaoBaseRow[]

  return NextResponse.json({
    servico,
    tipo_unidade: tipoUnidadeRaw,
    total: rows.length,
    rows,
  })
}
