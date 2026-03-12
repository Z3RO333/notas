import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  FinanceiroImportBatchResult,
  FinanceiroImportError,
  FinanceiroImportRow,
  FinanceiroTipoOrdem,
  UserRole,
} from '@/lib/types/database'

type Body = {
  rows: FinanceiroImportRow[]
  sourceFileName?: string | null
}

type FinanceiroPayload = {
  ordem_codigo: string
  tipo_ordem: FinanceiroTipoOrdem
  numero_nota: string | null
  data_entrada: string
  inicio_programado: string | null
  denominacao_unidade: string | null
  texto_breve: string | null
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  custos_estimados: number
  custos_totais_materiais: number
  custos_adicionais: number
  custos_totais_reais: number
  source_file_name: string | null
  imported_by: string
  importado_em: string
  updated_at: string
  raw_payload: Record<string, unknown>
}

const MAX_ROWS_PER_BATCH = 250
const VALID_TIPOS = new Set<FinanceiroTipoOrdem>(['PMOS', 'PMPL'])

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTipoOrdem(value: unknown): FinanceiroTipoOrdem | null {
  const trimmed = normalizeOptionalText(value)?.toUpperCase()
  if (!trimmed) return null
  return VALID_TIPOS.has(trimmed as FinanceiroTipoOrdem) ? trimmed as FinanceiroTipoOrdem : null
}

function normalizeMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2))
  }

  const text = normalizeOptionalText(value)
  if (!text) return 0

  const compact = text.replace(/\s+/g, '')
  const brPattern = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/
  const usPattern = /^-?\d{1,3}(,\d{3})*(\.\d+)?$/

  let normalized = compact
  if (brPattern.test(compact)) {
    normalized = compact.replace(/\./g, '').replace(',', '.')
  } else if (usPattern.test(compact)) {
    normalized = compact.replace(/,/g, '')
  } else if (/^-?\d+,\d+$/.test(compact)) {
    normalized = compact.replace(',', '.')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

function parseDateOnly(value: unknown): string | null {
  const text = normalizeOptionalText(value)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function normalizeRow(
  row: FinanceiroImportRow,
  sourceFileName: string | null,
  adminId: string,
  now: string,
): { payload: FinanceiroPayload | null; error: FinanceiroImportError | null } {
  const ordemCodigo = normalizeOptionalText(row.ordem_codigo)
  if (!ordemCodigo) {
    return {
      payload: null,
      error: { linha: row.rowIndex, ordem_codigo: '', motivo: 'Codigo da ordem obrigatorio' },
    }
  }

  const tipoOrdem = normalizeTipoOrdem(row.tipo_ordem)
  if (!tipoOrdem) {
    return {
      payload: null,
      error: { linha: row.rowIndex, ordem_codigo: ordemCodigo, motivo: 'Tipo de ordem invalido (use PMOS ou PMPL)' },
    }
  }

  const dataEntrada = parseDateOnly(row.data_entrada)
  if (!dataEntrada) {
    return {
      payload: null,
      error: { linha: row.rowIndex, ordem_codigo: ordemCodigo, motivo: 'Data de entrada invalida ou ausente' },
    }
  }

  return {
    error: null,
    payload: {
      ordem_codigo: ordemCodigo,
      tipo_ordem: tipoOrdem,
      numero_nota: normalizeOptionalText(row.numero_nota),
      data_entrada: dataEntrada,
      inicio_programado: parseDateOnly(row.inicio_programado) ?? null,
      denominacao_unidade: normalizeOptionalText(row.denominacao_unidade),
      texto_breve: normalizeOptionalText(row.texto_breve),
      fornecedor_codigo: normalizeOptionalText(row.fornecedor_codigo),
      fornecedor_nome: normalizeOptionalText(row.fornecedor_nome),
      custos_estimados: normalizeMoney(row.custos_estimados),
      custos_totais_materiais: normalizeMoney(row.custos_totais_materiais),
      custos_adicionais: normalizeMoney(row.custos_adicionais),
      custos_totais_reais: normalizeMoney(row.custos_totais_reais),
      source_file_name: sourceFileName,
      imported_by: adminId,
      importado_em: now,
      updated_at: now,
      raw_payload: row as unknown as Record<string, unknown>,
    },
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: adminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (adminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const role = loggedAdmin.role as UserRole
  if (role !== 'gestor') {
    return NextResponse.json({ error: 'Somente gestores podem importar financeiro' }, { status: 403 })
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

  const sourceFileName = normalizeOptionalText(body.sourceFileName)
  const adminId = loggedAdmin.id as string
  const now = new Date().toISOString()

  const deduped = new Map<string, FinanceiroPayload>()
  const errors: FinanceiroImportError[] = []
  let skipped = 0

  for (const row of rows) {
    const normalized = normalizeRow(row, sourceFileName, adminId, now)
    if (normalized.error) {
      errors.push(normalized.error)
      continue
    }

    const payload = normalized.payload!
    if (deduped.has(payload.ordem_codigo)) skipped++
    deduped.set(payload.ordem_codigo, payload)
  }

  const payloads = Array.from(deduped.values())
  if (payloads.length === 0) {
    const result: FinanceiroImportBatchResult = { created: 0, updated: 0, skipped, errors }
    return NextResponse.json(result)
  }

  const adminClient = createAdminClient()

  const { data: existingRows, error: existingError } = await adminClient
    .from('ordens_financeiro_importado')
    .select('ordem_codigo')
    .in('ordem_codigo', payloads.map((row) => row.ordem_codigo))

  if (existingError) {
    return NextResponse.json({ error: `Erro ao consultar financeiro existente: ${existingError.message}` }, { status: 500 })
  }

  const existingCodes = new Set((existingRows ?? []).map((row) => row.ordem_codigo as string))

  const { error: upsertError } = await adminClient
    .from('ordens_financeiro_importado')
    .upsert(payloads, { onConflict: 'ordem_codigo' })

  if (upsertError) {
    return NextResponse.json({ error: `Erro ao importar financeiro: ${upsertError.message}` }, { status: 500 })
  }

  const created = payloads.filter((row) => !existingCodes.has(row.ordem_codigo)).length
  const updated = payloads.length - created

  // Preenche data_entrada em ordens_notas_acompanhamento (Databricks) onde estiver nula,
  // cruzando pelo ordem_codigo: PMPL usa inicio_programado, PMOS usa data_entrada.
  await adminClient.rpc('backfill_data_entrada_from_financeiro', {
    p_codigos: payloads.map((row) => row.ordem_codigo),
  })

  const { error: auditError } = await adminClient
    .from('admin_audit_log')
    .insert({
      gestor_id: adminId,
      acao: 'importar_financeiro_planilha',
      alvo_id: null,
      detalhes: {
        source_file_name: sourceFileName,
        batch_size: rows.length,
        valid_rows: payloads.length,
        created,
        updated,
        skipped,
        erros: errors.length,
        tipos: Array.from(new Set(payloads.map((row) => row.tipo_ordem))),
      },
    })

  if (auditError) {
    console.error('[financeiro/importar] Falha ao gravar audit log:', auditError.message)
  }

  const result: FinanceiroImportBatchResult = { created, updated, skipped, errors }
  return NextResponse.json(result)
}
