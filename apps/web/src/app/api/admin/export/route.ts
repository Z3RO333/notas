import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import { getRawStatusLabel } from '@/lib/orders/status-raw'

function toCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const escaped = text.replace(/"/g, '""')
  return `"${escaped}"`
}

export async function GET(request: Request) {
  const ctx = await getCurrentRequestAdminContext()

  if (!ctx.isAuthenticated) {
    return new NextResponse('Nao autenticado', { status: 401 })
  }
  if (!ctx.adminId || ctx.role !== 'gestor') {
    return new NextResponse('Sem permissao', { status: 403 })
  }

  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') ?? 'ordens'
  const supabase = await createClient()

  if (scope !== 'ordens') {
    return new NextResponse('Escopo de exportacao inválido', { status: 400 })
  }

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 29)

  const { data, error } = await supabase
    .from('vw_ordens_notas_painel')
    .select('numero_nota, ordem_codigo, unidade, responsavel_atual_nome, administrador_nome, status_ordem_raw, dias_em_aberto, ordem_detectada_em')
    .gte('ordem_detectada_em', cutoff.toISOString())
    .order('ordem_detectada_em', { ascending: false })
    .limit(10000)

  if (error) {
    return new NextResponse(`Erro ao consultar dados: ${error.message}`, { status: 500 })
  }

  if (!data || data.length === 0) {
    return new NextResponse('Nenhum dado encontrado para o período', { status: 404 })
  }

  const headers = [
    'numero_nota',
    'ordem_codigo',
    'unidade',
    'responsavel_atual',
    'responsavel_origem',
    'status_ordem_raw',
    'status_label',
    'dias_em_aberto',
    'ordem_detectada_em',
  ]

  const lines = [headers.join(',')]

  for (const row of data) {
    lines.push([
      toCsvCell(row.numero_nota),
      toCsvCell(row.ordem_codigo),
      toCsvCell(row.unidade),
      toCsvCell(row.responsavel_atual_nome),
      toCsvCell(row.administrador_nome),
      toCsvCell(row.status_ordem_raw),
      toCsvCell(getRawStatusLabel(row.status_ordem_raw)),
      toCsvCell(row.dias_em_aberto),
      toCsvCell(row.ordem_detectada_em),
    ].join(','))
  }

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ordens_acompanhamento.csv"',
    },
  })
}
