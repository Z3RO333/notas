import type { NotaOperacaoEstado, NotaPanelData, NotaStatusOperacional } from '@/lib/types/database'

const VALID_STATUS_OPERACIONAL = new Set<NotaStatusOperacional>([
  'PENDENTE',
  'EM_GERACAO',
  'ALERTA',
  'CONFIRMADA_VIROU_ORDEM',
])

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

function asStatus(value: unknown): NotaStatusOperacional | null {
  const text = asText(value)
  if (!text) return null
  return VALID_STATUS_OPERACIONAL.has(text as NotaStatusOperacional)
    ? (text as NotaStatusOperacional)
    : null
}

export function toNotaOperacaoEstado(
  row: UnknownRecord | null | undefined,
): NotaOperacaoEstado | null {
  if (!row) return null

  const notaId = asText(row.nota_id)
  const numeroNota = asText(row.numero_nota)
  const statusOperacional = asStatus(row.status_operacional)
  const ttlMinutos = asInt(row.ttl_minutos)
  const createdAt = asText(row.created_at)
  const updatedAt = asText(row.updated_at)

  if (!notaId || !numeroNota || !statusOperacional || ttlMinutos === null || !createdAt || !updatedAt) {
    return null
  }

  return {
    nota_id: notaId,
    numero_nota: numeroNota,
    status_operacional: statusOperacional,
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

export function applyOperationalStateToNota(
  nota: NotaPanelData,
  state: NotaOperacaoEstado | null,
): NotaPanelData {
  if (!state) {
    return {
      ...nota,
      status_operacional: null,
      em_geracao_por_admin_id: null,
      em_geracao_por_email: null,
      em_geracao_em: null,
      ultima_copia_em: null,
      ttl_minutos: null,
      numero_ordem_confirmada: null,
      confirmada_em: null,
    }
  }

  return {
    ...nota,
    status_operacional: state.status_operacional,
    em_geracao_por_admin_id: state.em_geracao_por_admin_id,
    em_geracao_por_email: state.em_geracao_por_email,
    em_geracao_em: state.em_geracao_em,
    ultima_copia_em: state.ultima_copia_em,
    ttl_minutos: state.ttl_minutos,
    numero_ordem_confirmada: state.numero_ordem_confirmada,
    confirmada_em: state.confirmada_em,
  }
}

export function clearOperationalStateFromNota(nota: NotaPanelData): NotaPanelData {
  return applyOperationalStateToNota(nota, null)
}
