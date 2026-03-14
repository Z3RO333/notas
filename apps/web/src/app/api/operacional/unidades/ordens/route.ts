import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/database'

type OperacionalOrderRow = {
  id: string
  ordem_codigo: string | null
  unidade: string | null
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  status_ordem_raw: string | null
  ordem_detectada_em: string | null
  data_entrada: string | null
  tipo_ordem: string | null
  texto_breve: string | null
  numero_nota: string | null
}

const STATUS_CONCLUIDOS = new Set([
  'CANCELADO',
  'CONCLUIDO',
  'AGUARDANDO_FATURAMENTO_NF',
  'EXECUCAO_SATISFATORIO',
  'EXECUCAO_SATISFATORIA',
  'AVALIACAO_DA_EXECUCAO',
  'AVALIACAO_DE_EXECUCAO',
])

const STATUS_ABERTOS = new Set([
  'ABERTO',
  'ABERTA',
  'EM_EXECUCAO',
  'EQUIPAMENTO_EM_CONSERTO',
  'EXECUCAO_NAO_REALIZADA',
  'ENVIAR_EMAIL_PFORNECEDOR',
  'EM_PROCESSAMENTO',
  'EXECUCAO_INSATISFATORIO',
])

function normalizeText(value: string | null): string {
  return (value ?? '').trim()
}

function normalizeSupplierCode(value: string | null): string {
  return normalizeText(value).replace(/\D/g, '')
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
  if (role !== 'gestor') {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const unidade = normalizeText(searchParams.get('unidade'))
  const startIso = normalizeText(searchParams.get('start'))
  const endExclusiveIso = normalizeText(searchParams.get('end'))
  const fornecedorCodigo = normalizeText(searchParams.get('fornecedor'))

  if (!unidade || !startIso || !endExclusiveIso) {
    return NextResponse.json({ error: 'Parametros obrigatorios ausentes' }, { status: 400 })
  }

  const [operacionaisResult, query] = await Promise.all([
    supabase
      .from('dim_operacionais')
      .select('codigo')
      .limit(5000),
    supabase
    .from('ordens_notas_acompanhamento')
    .select('id, ordem_codigo, unidade, fornecedor_codigo, fornecedor_nome, status_ordem_raw, ordem_detectada_em, data_entrada, tipo_ordem, texto_breve, numero_nota')
    .eq('unidade', unidade)
    .gte('ordem_detectada_em', startIso)
    .lt('ordem_detectada_em', endExclusiveIso)
    .order('ordem_detectada_em', { ascending: false })
    .limit(500),
  ])

  if (query.error) {
    return NextResponse.json({ error: query.error.message }, { status: 500 })
  }
  if (operacionaisResult.error) {
    return NextResponse.json({ error: operacionaisResult.error.message }, { status: 500 })
  }

  const allowedSupplierCodes = new Set(
    (operacionaisResult.data ?? [])
      .map((row) => normalizeSupplierCode(row.codigo ?? null))
      .filter(Boolean)
  )

  const rows = ((query.data ?? []) as OperacionalOrderRow[])
    .filter((row) => {
      const normalizedSupplier = normalizeSupplierCode(row.fornecedor_codigo)
      if (!allowedSupplierCodes.has(normalizedSupplier)) return false
      if (!fornecedorCodigo) return true
      return normalizedSupplier === fornecedorCodigo
    })

  const summary = rows.reduce(
    (acc, row) => {
      const status = normalizeText(row.status_ordem_raw).toUpperCase()
      acc.total += 1
      if (STATUS_CONCLUIDOS.has(status)) acc.atendidas += 1
      if (STATUS_ABERTOS.has(status)) acc.pendentes += 1
      return acc
    },
    { total: 0, atendidas: 0, pendentes: 0 }
  )

  return NextResponse.json({
    unidade,
    fornecedorCodigo: fornecedorCodigo || null,
    summary,
    rows,
  })
}
