import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentRequestAdminContext } from '@/lib/auth/request-admin-context'
import type { OrdemConsulta, ConsultasResponse } from '@/lib/types/operacional'

const ALLOWED_ROLES = ['admin', 'gestor', 'viewer', 'operacional'] as const

type RpcRow = {
  ordem_id: string
  ordem_codigo: string
  numero_nota: string
  unidade: string | null
  status_ordem_raw: string
  dias_em_aberto: number
  semaforo_atraso: string
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  descricao: string | null
  responsavel_nome: string | null
  responsavel_email: string | null
  ordem_detectada_em: string
  tipo_ordem: string | null
}

function trim(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  return v.length > 0 ? v : null
}

const PAGE_SIZE = 20

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const ctx = await getCurrentRequestAdminContext({ allowMaintainerView: false })

  if (!ctx.email) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  if (!ctx.role || !(ALLOWED_ROLES as readonly string[]).includes(ctx.role)) {
    return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 })
  }

  const url = new URL(request.url)
  const q = trim(url.searchParams.get('q'))
  const status = trim(url.searchParams.get('status'))
  const fornecedorCodigo = trim(url.searchParams.get('fornecedor_codigo'))
  const unidade = trim(url.searchParams.get('unidade'))
  const cursorDetectada = trim(url.searchParams.get('cursor_detectada'))
  const cursorId = trim(url.searchParams.get('cursor_id'))

  const { data, error } = await supabase.rpc('consultar_ordens_operacional', {
    p_q: q,
    p_fornecedor_codigo: fornecedorCodigo,
    p_unidade: unidade,
    p_status: status,
    p_limit: PAGE_SIZE + 1,
    p_cursor_detectada: cursorDetectada ?? null,
    p_cursor_id: cursorId ?? null,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as RpcRow[]
  const hasMore = rows.length > PAGE_SIZE
  const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  const ordens: OrdemConsulta[] = sliced.map((row) => ({
    ordemId: row.ordem_id,
    ordemCodigo: row.ordem_codigo,
    numeroNota: row.numero_nota,
    unidade: row.unidade,
    statusOrdemRaw: row.status_ordem_raw,
    diasEmAberto: Number(row.dias_em_aberto),
    semaforoAtraso: (row.semaforo_atraso as OrdemConsulta['semaforoAtraso']) ?? 'neutro',
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedorNome: row.fornecedor_nome,
    descricao: row.descricao,
    responsavelNome: row.responsavel_nome,
    responsavelEmail: row.responsavel_email,
    ordemDetectadaEm: row.ordem_detectada_em,
    tipoOrdem: row.tipo_ordem,
  }))

  const last = sliced[sliced.length - 1]
  const nextCursor =
    hasMore && last ? { detectada: last.ordem_detectada_em, id: last.ordem_id } : null

  const response: ConsultasResponse = { ordens, nextCursor }
  return NextResponse.json(response)
}
