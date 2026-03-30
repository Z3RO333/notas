import type { TipoUnidade } from '@/lib/types/database'

const GESTAO_TIPOS: TipoUnidade[] = ['LOJA', 'FARMA', 'CD']

function isGestaoTipo(value: string | null | undefined): value is TipoUnidade {
  return GESTAO_TIPOS.includes(value as TipoUnidade)
}

function sanitizeGestaoLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeGestaoLabelKey(value: string): string {
  return sanitizeGestaoLabel(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function scoreGestaoLabel(value: string): number {
  const sanitized = sanitizeGestaoLabel(value)
  let score = 0

  if (sanitized !== sanitized.toUpperCase()) score += 2
  if (/[\u00C0-\u017F]/.test(sanitized)) score += 1
  if (!/\s{2,}/.test(value)) score += 1

  return score
}

function pickPreferredGestaoLabel(current: string | undefined, candidate: string): string {
  const sanitizedCandidate = sanitizeGestaoLabel(candidate)
  if (!current) return sanitizedCandidate

  const currentScore = scoreGestaoLabel(current)
  const candidateScore = scoreGestaoLabel(sanitizedCandidate)

  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? sanitizedCandidate : current
  }

  return sanitizedCandidate.localeCompare(current, 'pt-BR', { sensitivity: 'base' }) < 0
    ? sanitizedCandidate
    : current
}

export function buildGestaoLojasDisponiveis(
  rows: Array<{ nome_loja: string | null | undefined; tipo_unidade: string | null | undefined }>,
): string[] {
  const deduped = new Map<string, string>()

  for (const row of rows) {
    if (!isGestaoTipo(row.tipo_unidade) || !row.nome_loja) continue

    const label = sanitizeGestaoLabel(row.nome_loja)
    if (!label) continue

    const key = normalizeGestaoLabelKey(label)
    deduped.set(key, pickPreferredGestaoLabel(deduped.get(key), label))
  }

  return Array.from(deduped.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
