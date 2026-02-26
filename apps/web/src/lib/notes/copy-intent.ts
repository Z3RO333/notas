import type { NotaOperacaoEstado } from '@/lib/types/database'

const NOTA_OPERACAO_EVENT = 'notas:operacao:update'

export interface NotaOperacaoEventDetail {
  notaId: string
  state: NotaOperacaoEstado | null
}

export type CopyIntentResult =
  | {
    ok: true
    status: number
    data: NotaOperacaoEstado
  }
  | {
    ok: false
    status: number
    code: string
    message: string
    ownerEmail: string | null
    canOverride: boolean
  }

type CopyIntentRequest = {
  notaId: string
  forceOverride?: boolean
}

type UnknownRecord = Record<string, unknown>

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return null
}

function parseOperacaoEstado(value: unknown): NotaOperacaoEstado | null {
  if (!value || typeof value !== 'object') return null
  const row = value as UnknownRecord
  const notaId = asText(row.nota_id)
  const numeroNota = asText(row.numero_nota)
  const statusOperacional = asText(row.status_operacional)
  const ttlMinutos = asInt(row.ttl_minutos)
  const createdAt = asText(row.created_at) ?? new Date().toISOString()
  const updatedAt = asText(row.updated_at) ?? new Date().toISOString()

  if (!notaId || !numeroNota || !statusOperacional || ttlMinutos === null) return null

  return {
    nota_id: notaId,
    numero_nota: numeroNota,
    status_operacional: statusOperacional as NotaOperacaoEstado['status_operacional'],
    em_geracao_por_admin_id: asText(row.em_geracao_por_admin_id),
    em_geracao_por_email: asText(row.em_geracao_por_email),
    em_geracao_em: asText(row.em_geracao_em),
    ultima_copia_em: asText(row.ultima_copia_em),
    ttl_minutos: ttlMinutos,
    numero_ordem_confirmada: asText(row.numero_ordem_confirmada),
    confirmada_em: asText(row.confirmada_em),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

export function emitNotaOperacaoEvent(detail: NotaOperacaoEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NotaOperacaoEventDetail>(NOTA_OPERACAO_EVENT, { detail }))
}

export function listenNotaOperacaoEvent(
  listener: (detail: NotaOperacaoEventDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<NotaOperacaoEventDetail>
    if (!customEvent.detail) return
    listener(customEvent.detail)
  }
  window.addEventListener(NOTA_OPERACAO_EVENT, handler)
  return () => window.removeEventListener(NOTA_OPERACAO_EVENT, handler)
}

export async function marcarNotaEmGeracao({
  notaId,
  forceOverride = false,
}: CopyIntentRequest): Promise<CopyIntentResult> {
  const response = await fetch('/api/notas/copy-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notaId, forceOverride }),
  })

  let payload: UnknownRecord = {}
  try {
    const parsed = await response.json()
    if (parsed && typeof parsed === 'object') payload = parsed as UnknownRecord
  } catch {
    payload = {}
  }

  const state = parseOperacaoEstado(payload.data)
  if (response.ok && state) {
    return {
      ok: true,
      status: response.status,
      data: state,
    }
  }

  return {
    ok: false,
    status: response.status,
    code: asText(payload.code) ?? 'copy_intent_error',
    message: asText(payload.message) ?? 'Falha ao atualizar estado operacional.',
    ownerEmail: asText(payload.ownerEmail),
    canOverride: payload.canOverride === true,
  }
}
