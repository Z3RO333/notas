import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type {
  OrderDetailDrawerData,
  OrderTimelineEvent,
  OrdemNotaAcompanhamento,
  UserRole,
} from '@/lib/types/database'

function asUuid(value: string | null): string | null {
  if (!value) return null
  const text = value.trim()
  if (!text) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return null
  return text
}

function buildOrderEvent(row: {
  id: string
  status_anterior: string | null
  status_novo: string
  status_raw: string | null
  origem: string
  created_at: string
}): OrderTimelineEvent {
  const titulo = `Status da ordem: ${row.status_novo}`
  const partes = [
    row.status_anterior ? `Anterior: ${row.status_anterior}` : null,
    row.status_raw ? `SAP: ${row.status_raw}` : null,
    row.origem ? `Origem: ${row.origem}` : null,
  ].filter(Boolean)

  return {
    id: `ordem-${row.id}`,
    origem: 'ordem',
    created_at: row.created_at,
    titulo,
    descricao: partes.join(' • ') || 'Atualizacao de status da ordem',
  }
}

function buildNotaEvent(row: {
  id: string
  campo_alterado: string
  valor_anterior: string | null
  valor_novo: string | null
  motivo: string | null
  created_at: string
}): OrderTimelineEvent {
  const titulo = `Nota: ${row.campo_alterado}`
  const partes = [
    row.valor_anterior !== null ? `De: ${row.valor_anterior}` : null,
    row.valor_novo !== null ? `Para: ${row.valor_novo}` : null,
    row.motivo ? `Motivo: ${row.motivo}` : null,
  ].filter(Boolean)

  return {
    id: `nota-${row.id}`,
    origem: 'nota',
    created_at: row.created_at,
    titulo,
    descricao: partes.join(' • ') || 'Atualizacao da nota',
  }
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
  const { searchParams } = new URL(request.url)
  const notaId = asUuid(searchParams.get('notaId'))

  if (!notaId) {
    return NextResponse.json({ error: 'notaId invalido' }, { status: 400 })
  }

  const ordemResult = await supabase
    .from('vw_ordens_notas_painel')
    .select('*')
    .eq('nota_id', notaId)
    .limit(1)
    .maybeSingle()

  if (ordemResult.error) {
    return NextResponse.json({ error: ordemResult.error.message }, { status: 500 })
  }

  if (!ordemResult.data) {
    return NextResponse.json({ error: 'Ordem nao encontrada para esta nota' }, { status: 404 })
  }

  const ordem = ordemResult.data as OrdemNotaAcompanhamento
  if (role !== 'gestor' && ordem.responsavel_atual_id !== loggedAdmin.id) {
    return NextResponse.json({ error: 'Sem permissao para visualizar esta ordem' }, { status: 403 })
  }

  const [notaResult, ordemHistoricoResult, notasHistoricoResult] = await Promise.all([
    supabase
      .from('notas_manutencao')
      .select('descricao')
      .eq('id', notaId)
      .maybeSingle(),
    supabase
      .from('ordens_notas_historico')
      .select('id, status_anterior, status_novo, status_raw, origem, created_at')
      .eq('ordem_id', ordem.ordem_id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('notas_historico')
      .select('id, campo_alterado, valor_anterior, valor_novo, motivo, created_at')
      .eq('nota_id', notaId)
      .in('campo_alterado', ['administrador_id', 'status'])
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (notaResult.error) {
    return NextResponse.json({ error: notaResult.error.message }, { status: 500 })
  }

  if (ordemHistoricoResult.error) {
    return NextResponse.json({ error: ordemHistoricoResult.error.message }, { status: 500 })
  }

  if (notasHistoricoResult.error) {
    return NextResponse.json({ error: notasHistoricoResult.error.message }, { status: 500 })
  }

  const envolvidosIds = Array.from(
    new Set((ordem.envolvidos_admin_ids ?? []).filter(Boolean))
  )

  const envolvidosResult = envolvidosIds.length > 0
    ? await supabase
      .from('administradores')
      .select('id, nome')
      .in('id', envolvidosIds)
    : { data: [], error: null }

  if (envolvidosResult.error) {
    return NextResponse.json({ error: envolvidosResult.error.message }, { status: 500 })
  }

  const ordemEvents = ((ordemHistoricoResult.data ?? []) as Array<{
    id: string
    status_anterior: string | null
    status_novo: string
    status_raw: string | null
    origem: string
    created_at: string
  }>).map(buildOrderEvent)

  const notaEvents = ((notasHistoricoResult.data ?? []) as Array<{
    id: string
    campo_alterado: string
    valor_anterior: string | null
    valor_novo: string | null
    motivo: string | null
    created_at: string
  }>).map(buildNotaEvent)

  const timeline = [...ordemEvents, ...notaEvents]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 10)

  const payload: OrderDetailDrawerData = {
    ordem,
    descricao_nota: notaResult.data?.descricao ?? null,
    envolvidos: ((envolvidosResult.data ?? []) as Array<{ id: string; nome: string }>),
    timeline,
  }

  return NextResponse.json(payload)
}
