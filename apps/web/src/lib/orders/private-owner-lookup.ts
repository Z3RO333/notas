import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

const MIN_PRIVATE_OWNER_LOOKUP_DIGITS = 5

function normalizeLookupDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  if (!digits) return null

  const normalized = digits.replace(/^0+/, '')
  return normalized.length > 0 ? normalized : '0'
}

export function normalizePrivateOwnerLookupValue(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return null

  const normalized = normalizeLookupDigits(trimmed)
  if (!normalized) return null

  return normalized.length >= MIN_PRIVATE_OWNER_LOOKUP_DIGITS ? normalized : null
}

export function isPrivateOwnerLookupActive(value: string | null | undefined): boolean {
  return normalizePrivateOwnerLookupValue(value) !== null
}

export function matchesPrivateOwnerLookupRow(
  row: Pick<OrdemNotaAcompanhamento, 'ordem_codigo' | 'numero_nota'>,
  normalizedLookup: string | null | undefined,
): boolean {
  if (!normalizedLookup) return false

  return [row.ordem_codigo, row.numero_nota].some((value) => normalizeLookupDigits(value) === normalizedLookup)
}
