import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type UnknownRecord = Record<string, unknown>

interface CopyIntentBody {
  notaId: string
  forceOverride?: boolean
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseBody(body: unknown): CopyIntentBody | null {
  if (!body || typeof body !== 'object') return null
  const row = body as UnknownRecord
  const notaId = asText(row.notaId)
  if (!notaId || !UUID_REGEX.test(notaId)) return null

  return {
    notaId,
    forceOverride: row.forceOverride === true,
  }
}

function normalizeRpcPayload(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const first = value[0]
    return first && typeof first === 'object' ? (first as UnknownRecord) : null
  }
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ code: 'unauthorized', message: 'Não autenticado.' }, { status: 401 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ code: 'invalid_body', message: 'Body inválido.' }, { status: 400 })
  }

  const body = parseBody(rawBody)
  if (!body) {
    return NextResponse.json({ code: 'invalid_body', message: 'notaId inválido.' }, { status: 400 })
  }

  const rpcResult = await supabase.rpc('marcar_nota_em_geracao', {
    p_nota_id: body.notaId,
    p_force_override: body.forceOverride === true,
    p_trigger: 'copy_button',
  })

  if (rpcResult.error) {
    const errorText = (rpcResult.error.message || '').toLowerCase()
    if (errorText.includes('acesso negado') || rpcResult.error.code === '42501') {
      return NextResponse.json({ code: 'forbidden', message: 'Sem permissão para esta ação.' }, { status: 403 })
    }

    return NextResponse.json(
      { code: 'rpc_error', message: rpcResult.error.message || 'Falha ao marcar nota em geração.' },
      { status: 500 },
    )
  }

  const payload = normalizeRpcPayload(rpcResult.data)
  if (!payload) {
    return NextResponse.json({ code: 'rpc_empty', message: 'Resposta inválida da RPC.' }, { status: 500 })
  }

  const ok = payload.ok === true
  const code = asText(payload.code) ?? 'copy_intent_error'
  const message = asText(payload.message) ?? 'Não foi possível atualizar a nota.'
  const ownerEmail = asText(payload.owner_email)
  const canOverride = payload.can_override === true

  if (!ok) {
    if (code === 'already_in_progress_by_other') {
      return NextResponse.json(
        { ok: false, code, message, ownerEmail, canOverride },
        { status: 409 },
      )
    }
    if (code === 'nota_not_found') {
      return NextResponse.json({ ok: false, code, message }, { status: 404 })
    }
    if (code === 'nota_not_open' || code === 'already_has_order') {
      return NextResponse.json({ ok: false, code, message }, { status: 409 })
    }
    return NextResponse.json({ ok: false, code, message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    code,
    data: {
      nota_id: asText(payload.nota_id),
      numero_nota: asText(payload.numero_nota),
      status_operacional: asText(payload.status_operacional),
      em_geracao_por_admin_id: asText(payload.em_geracao_por_admin_id),
      em_geracao_por_email: asText(payload.em_geracao_por_email),
      em_geracao_em: asText(payload.em_geracao_em),
      ultima_copia_em: asText(payload.ultima_copia_em),
      ttl_minutos: typeof payload.ttl_minutos === 'number' ? payload.ttl_minutos : Number(payload.ttl_minutos ?? 60),
      numero_ordem_confirmada: asText(payload.numero_ordem_confirmada),
      confirmada_em: asText(payload.confirmada_em),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  })
}
