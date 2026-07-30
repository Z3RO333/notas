import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'
import type { UserRole } from '@/lib/types/database'

export type CartaoImportRow = {
  data: string
  fornecedor: string
  centro_custo: string | null
  valor: number
  source_sheet: string | null
}

export type CartaoImportBatchResult = {
  inserted: number
  skipped: number
}

type Body = {
  rows: CartaoImportRow[]
}

const MAX_ROWS_PER_BATCH = 500

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
  const supabase = createAdminClient()
  const email = await getSessionEmail()

  if (!email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: adminError } = await supabase
    .from('vw_administrador_por_email')
    .select('id, role')
    .eq('email', email)
    .single()

  if (adminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const role = loggedAdmin.role as UserRole
  if (role !== 'gestor') {
    return NextResponse.json({ error: 'Somente gestores podem importar cartao corporativo' }, { status: 403 })
  }

  let body: Body
  try {
    body = await request.json() as Body
  } catch {
    return NextResponse.json({ error: 'Body invalido' }, { status: 400 })
  }

  const rows = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'rows deve ser um array nao vazio' }, { status: 400 })
  }

  if (rows.length > MAX_ROWS_PER_BATCH) {
    return NextResponse.json({ error: `Maximo ${MAX_ROWS_PER_BATCH} rows por batch` }, { status: 400 })
  }

  const now = new Date().toISOString()
  const payloads = rows.map((row) => ({
    data: normalizeText(row.data) ?? '',
    fornecedor: normalizeText(row.fornecedor) ?? '',
    centro_custo: normalizeText(row.centro_custo),
    valor: typeof row.valor === 'number' ? Number(row.valor.toFixed(2)) : 0,
    source_sheet: normalizeText(row.source_sheet),
    importado_em: now,
  })).filter((row) => row.data && row.fornecedor && row.valor > 0)

  if (payloads.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: rows.length } as CartaoImportBatchResult)
  }

  const adminClient = createAdminClient()

  const { error: upsertError, count } = await adminClient
    .from('cartao_corporativo_gastos')
    .upsert(payloads, {
      onConflict: 'data,fornecedor,centro_custo,valor',
      ignoreDuplicates: true,
      count: 'exact',
    })

  if (upsertError) {
    return NextResponse.json(
      { error: `Erro ao importar cartao: ${upsertError.message}` },
      { status: 500 },
    )
  }

  const inserted = count ?? payloads.length
  const skipped = rows.length - payloads.length

  return NextResponse.json({ inserted, skipped } as CartaoImportBatchResult)
}
