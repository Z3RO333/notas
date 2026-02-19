import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type {
  ImportBatchResult,
  ImportMode,
  ImportRowError,
  MappedImportRow,
  UserRole,
} from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, 'aberta' | 'em_tratativa' | 'concluida' | 'cancelada'> = {
  aberta: 'aberta',
  aberto: 'aberta',
  nova: 'aberta',
  novo: 'aberta',
  em_tratativa: 'em_tratativa',
  em_andamento: 'em_tratativa',
  em_execucao: 'em_tratativa',
  concluida: 'concluida',
  concluido: 'concluida',
  fechado: 'concluida',
  fechada: 'concluida',
  encerrada: 'concluida',
  encerrado: 'concluida',
  cancelada: 'cancelada',
  cancelado: 'cancelada',
}

function normalizeStatus(
  raw: string | null,
): 'aberta' | 'em_tratativa' | 'concluida' | 'cancelada' | 'desconhecido' {
  if (!raw) return 'desconhecido'
  const key = raw.trim().toLowerCase().replace(/[\s-]/g, '_')
  return STATUS_MAP[key] ?? 'desconhecido'
}

// ---------------------------------------------------------------------------
// Date parsing — supports ISO and DD/MM/YYYY
// ---------------------------------------------------------------------------

function parseIsoDate(value: string | null): string | null {
  if (!value) return null
  // Try ISO first
  let d = new Date(value)
  if (!Number.isNaN(d.getTime())) return d.toISOString()
  // Try DD/MM/YYYY
  const brMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brMatch) {
    d = new Date(`${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Auth
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
  const adminId = loggedAdmin.id as string

  // 2. Parse body
  let body: { rows: MappedImportRow[]; mode: ImportMode }
  try {
    body = await request.json() as { rows: MappedImportRow[]; mode: ImportMode }
  } catch {
    return NextResponse.json({ error: 'Body invalido' }, { status: 400 })
  }

  const { rows, mode } = body

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows deve ser um array nao vazio' }, { status: 400 })
  }

  if (rows.length > 100) {
    return NextResponse.json({ error: 'Maximo 100 rows por batch' }, { status: 400 })
  }

  // 3. Enforce admin restrictions: admins can only update, not create
  const modeAllowsCreate = mode === 'create_and_update' || mode === 'create_only' || mode === 'skip_existing'
  if (role === 'admin' && modeAllowsCreate) {
    return NextResponse.json({ error: 'Administradores so podem usar o modo de atualizacao' }, { status: 403 })
  }

  // 4. Pre-fetch existing orders for this batch (one query instead of N)
  const ordemCodigos = rows.map((r) => r.ordem_codigo?.trim()).filter(Boolean) as string[]

  const { data: existingOrdens, error: lookupError } = await supabase
    .from('ordens_notas_acompanhamento')
    .select('id, ordem_codigo, administrador_id')
    .in('ordem_codigo', ordemCodigos)

  if (lookupError) {
    return NextResponse.json({ error: `Erro ao consultar ordens: ${lookupError.message}` }, { status: 500 })
  }

  const existingByCode = new Map(
    (existingOrdens ?? []).map((o) => [o.ordem_codigo as string, o as { id: string; ordem_codigo: string; administrador_id: string | null }])
  )

  // 5. Pre-fetch notas for creates (one query instead of N)
  const notaNumbers = rows
    .filter((r) => r.numero_nota)
    .map((r) => r.numero_nota!)

  const notaByNumber = new Map<string, string>()
  if (notaNumbers.length > 0) {
    const { data: notaRows } = await supabase
      .from('notas_manutencao')
      .select('id, numero_nota')
      .in('numero_nota', notaNumbers)

    for (const n of notaRows ?? []) {
      notaByNumber.set(n.numero_nota as string, n.id as string)
    }
  }

  // 6. Process each row
  const errors: ImportRowError[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  const now = new Date().toISOString()

  for (const row of rows) {
    const ordemCodigo = row.ordem_codigo?.trim()

    if (!ordemCodigo) {
      errors.push({ linha: row.rowIndex, ordem_codigo: '', motivo: 'ordem_codigo obrigatoria' })
      continue
    }

    const existing = existingByCode.get(ordemCodigo)
    const isNew = !existing

    // --- Scope check for admins ---
    if (role === 'admin' && existing && existing.administrador_id !== adminId) {
      errors.push({
        linha: row.rowIndex,
        ordem_codigo: ordemCodigo,
        motivo: 'Sem permissao para esta ordem',
      })
      skipped++
      continue
    }

    // --- Apply import mode ---
    if (isNew && mode === 'update_only') {
      skipped++
      continue
    }
    if (!isNew && (mode === 'create_only' || mode === 'skip_existing')) {
      skipped++
      continue
    }

    if (isNew) {
      // CREATE — requires nota_id FK
      const notaId = row.numero_nota ? notaByNumber.get(row.numero_nota) : undefined
      if (!notaId) {
        errors.push({
          linha: row.rowIndex,
          ordem_codigo: ordemCodigo,
          motivo: `Nota nao encontrada para numero_nota="${row.numero_nota ?? '(nao mapeado)'}" — necessario para criar novas ordens`,
        })
        continue
      }

      const { error: insertError } = await supabase
        .from('ordens_notas_acompanhamento')
        .insert({
          nota_id: notaId,
          numero_nota: row.numero_nota!,
          ordem_codigo: ordemCodigo,
          status_ordem: normalizeStatus(row.status_ordem_raw),
          status_ordem_raw: row.status_ordem_raw ?? null,
          centro: row.centro ?? null,
          ordem_detectada_em: parseIsoDate(row.ordem_detectada_em) ?? now,
          created_at: now,
          updated_at: now,
        })

      if (insertError) {
        errors.push({ linha: row.rowIndex, ordem_codigo: ordemCodigo, motivo: insertError.message })
      } else {
        created++
      }
    } else {
      // UPDATE — only overwrite fields that are non-null in this row
      const updatePayload: Record<string, unknown> = {
        updated_at: now,
        status_atualizado_em: now,
      }

      if (row.status_ordem_raw !== null) {
        updatePayload.status_ordem = normalizeStatus(row.status_ordem_raw)
        updatePayload.status_ordem_raw = row.status_ordem_raw
      }
      if (row.centro !== null) {
        updatePayload.centro = row.centro
      }
      if (row.ordem_detectada_em !== null) {
        const iso = parseIsoDate(row.ordem_detectada_em)
        if (iso) updatePayload.ordem_detectada_em = iso
      }

      const { error: updateError } = await supabase
        .from('ordens_notas_acompanhamento')
        .update(updatePayload)
        .eq('id', existing!.id)

      if (updateError) {
        errors.push({ linha: row.rowIndex, ordem_codigo: ordemCodigo, motivo: updateError.message })
      } else {
        updated++
      }
    }
  }

  // 7. Audit log — one entry per batch (non-fatal if it fails)
  const { error: auditError } = await supabase
    .from('admin_audit_log')
    .insert({
      gestor_id: adminId,
      acao: 'importar_planilha_ordens',
      alvo_id: null,
      detalhes: {
        mode,
        batch_size: rows.length,
        created,
        updated,
        skipped,
        erros: errors.length,
        primeiros_codigos: ordemCodigos.slice(0, 10),
      },
    })

  if (auditError) {
    console.error('[importar] Falha ao gravar audit log:', auditError.message)
  }

  const result: ImportBatchResult = { created, updated, skipped, errors }
  return NextResponse.json(result)
}
