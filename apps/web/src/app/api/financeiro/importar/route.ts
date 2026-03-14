import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  FinanceiroImportBatchResult,
  FinanceiroImportError,
  FinanceiroImportRow,
  FinanceiroImportScope,
  FinanceiroReplaceMode,
  FinanceiroTipoOrdem,
  UserRole,
} from '@/lib/types/database'
import {
  buildReplacementScopes,
  getCompetenciaDate,
  normalizeFinanceiroRow,
  normalizeOptionalText,
  type FinanceiroPayload,
} from './import-utils'

type Body = {
  rows: FinanceiroImportRow[]
  sourceFileName?: string | null
  replaceMode?: FinanceiroReplaceMode | null
}

type ExistingFinanceiroRow = {
  ordem_codigo: string
  tipo_ordem: FinanceiroTipoOrdem
  data_entrada: string | null
  inicio_programado: string | null
}

const MAX_ROWS_PER_REQUEST = 100_000
const LOOKUP_CHUNK_SIZE = 1000
const DELETE_CHUNK_SIZE = 200
const SELECT_PAGE_SIZE = 1000

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function normalizeReplaceMode(value: unknown): FinanceiroReplaceMode {
  return value === 'upsert' ? 'upsert' : 'competencia'
}

function isCompetenciaInScope(dateValue: string | null, scope: FinanceiroImportScope) {
  if (!dateValue) return false
  return dateValue >= scope.competencia_inicio && dateValue <= scope.competencia_fim
}

async function fetchExistingCodes(
  adminClient: ReturnType<typeof createAdminClient>,
  ordemCodigos: string[],
) {
  const existingCodes = new Set<string>()

  for (const chunk of chunkArray(ordemCodigos, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await adminClient
      .from('ordens_financeiro_importado')
      .select('ordem_codigo')
      .in('ordem_codigo', chunk)

    if (error) {
      throw new Error(`Erro ao consultar ordens financeiras existentes: ${error.message}`)
    }

    for (const row of data ?? []) {
      if (row.ordem_codigo) existingCodes.add(String(row.ordem_codigo))
    }
  }

  return existingCodes
}

async function fetchExistingRowsByType(
  adminClient: ReturnType<typeof createAdminClient>,
  tipoOrdem: FinanceiroTipoOrdem,
) {
  const rows: ExistingFinanceiroRow[] = []

  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const to = from + SELECT_PAGE_SIZE - 1
    const { data, error } = await adminClient
      .from('ordens_financeiro_importado')
      .select('ordem_codigo,tipo_ordem,data_entrada,inicio_programado')
      .eq('tipo_ordem', tipoOrdem)
      .range(from, to)

    if (error) {
      throw new Error(`Erro ao listar financeiro existente de ${tipoOrdem}: ${error.message}`)
    }

    const batch = (data ?? []) as ExistingFinanceiroRow[]
    rows.push(...batch)

    if (batch.length < SELECT_PAGE_SIZE) break
  }

  return rows
}

async function deleteRowsByCodes(
  adminClient: ReturnType<typeof createAdminClient>,
  ordemCodigos: string[],
) {
  let deleted = 0

  for (const chunk of chunkArray(ordemCodigos, DELETE_CHUNK_SIZE)) {
    const { error } = await adminClient
      .from('ordens_financeiro_importado')
      .delete()
      .in('ordem_codigo', chunk)

    if (error) {
      throw new Error(`Erro ao remover financeiro antigo do escopo: ${error.message}`)
    }

    deleted += chunk.length
  }

  return deleted
}

async function findMissingOperationalOrders(
  adminClient: ReturnType<typeof createAdminClient>,
  ordemCodigos: string[],
) {
  const existing = new Set<string>()

  for (const chunk of chunkArray(ordemCodigos, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await adminClient
      .from('ordens_notas_acompanhamento')
      .select('ordem_codigo')
      .in('ordem_codigo', chunk)

    if (error) {
      throw new Error(`Erro ao consultar base operacional: ${error.message}`)
    }

    for (const row of data ?? []) {
      if (row.ordem_codigo) existing.add(String(row.ordem_codigo))
    }
  }

  return ordemCodigos.filter((ordemCodigo) => !existing.has(ordemCodigo))
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

  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json({ error: `Maximo ${MAX_ROWS_PER_REQUEST} rows por importacao` }, { status: 400 })
  }

  const replaceMode = normalizeReplaceMode(body.replaceMode)
  const sourceFileName = normalizeOptionalText(body.sourceFileName)
  const adminId = loggedAdmin.id as string
  const now = new Date().toISOString()

  const deduped = new Map<string, FinanceiroPayload>()
  const errors: FinanceiroImportError[] = []
  let skipped = 0

  for (const row of rows) {
    const normalized = normalizeFinanceiroRow(row, sourceFileName, adminId, now)
    if (normalized.error) {
      errors.push(normalized.error)
      continue
    }

    const payload = normalized.payload!
    if (deduped.has(payload.ordem_codigo)) skipped += 1
    deduped.set(payload.ordem_codigo, payload)
  }

  const payloads = Array.from(deduped.values())
  if (payloads.length === 0) {
    const result: FinanceiroImportBatchResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      skipped,
      scopes: [],
      errors,
    }
    return NextResponse.json(result)
  }

  const adminClient = createAdminClient()
  const existingCodesBeforeReplace = await fetchExistingCodes(
    adminClient,
    payloads.map((row) => row.ordem_codigo),
  )

  const scopes = replaceMode === 'competencia'
    ? buildReplacementScopes(payloads)
    : []

  let deleted = 0
  if (replaceMode === 'competencia' && scopes.length > 0) {
    const rowsToDelete = new Set<string>()

    for (const scope of scopes) {
      const existingRows = await fetchExistingRowsByType(adminClient, scope.tipo_ordem)
      for (const row of existingRows) {
        const competenciaDate = getCompetenciaDate(
          row.tipo_ordem,
          row.data_entrada,
          row.inicio_programado,
        )

        if (isCompetenciaInScope(competenciaDate, scope)) {
          rowsToDelete.add(row.ordem_codigo)
        }
      }
    }

    deleted = await deleteRowsByCodes(adminClient, Array.from(rowsToDelete))
  }

  const { error: upsertError } = await adminClient
    .from('ordens_financeiro_importado')
    .upsert(payloads, { onConflict: 'ordem_codigo' })

  if (upsertError) {
    return NextResponse.json({ error: `Erro ao importar financeiro: ${upsertError.message}` }, { status: 500 })
  }

  const created = payloads.filter((row) => !existingCodesBeforeReplace.has(row.ordem_codigo)).length
  const updated = payloads.length - created

  const { data: backfillUpdated, error: backfillError } = await adminClient.rpc('backfill_data_entrada_from_financeiro', {
    p_codigos: payloads.map((row) => row.ordem_codigo),
  })

  if (backfillError) {
    console.error('[financeiro/importar] Falha no backfill_data_entrada_from_financeiro:', backfillError.message)
  }

  let missingOperationalOrderCodes: string[] = []
  try {
    missingOperationalOrderCodes = await findMissingOperationalOrders(
      adminClient,
      payloads.map((row) => row.ordem_codigo),
    )
  } catch (missingError) {
    console.error('[financeiro/importar] Falha ao checar ordens operacionais ausentes:', missingError)
  }

  const auditDetails = {
    source_file_name: sourceFileName,
    replace_mode: replaceMode,
    total_rows_received: rows.length,
    valid_rows: payloads.length,
    created,
    updated,
    deleted,
    skipped,
    erros: errors.length,
    tipos: Array.from(new Set(payloads.map((row) => row.tipo_ordem))),
    scopes,
    backfill_updated: typeof backfillUpdated === 'number' ? backfillUpdated : null,
    missing_operational_count: missingOperationalOrderCodes.length,
    missing_operational_order_codes: missingOperationalOrderCodes.slice(0, 25),
  }

  const { error: auditError } = await adminClient
    .from('admin_audit_log')
    .insert({
      gestor_id: adminId,
      acao: 'importar_financeiro_planilha',
      alvo_id: null,
      detalhes: auditDetails,
    })

  if (auditError) {
    console.error('[financeiro/importar] Falha ao gravar audit log:', auditError.message)
  }

  const result: FinanceiroImportBatchResult = {
    created,
    updated,
    deleted,
    skipped,
    scopes,
    missing_operational_count: missingOperationalOrderCodes.length,
    missing_operational_order_codes: missingOperationalOrderCodes.slice(0, 25),
    errors,
  }

  return NextResponse.json(result)
}
