import type { OrdersOwnerSummary } from '@/lib/types/database'

export type FixedOwnerKey = 'brenda' | 'adriano' | 'duran'

export type KnownOwnerCargoLabel =
  | 'PREVENTIVAS'
  | 'REFRIGERACAO'
  | 'CD MANAUS'
  | 'CD TURISMO'
  | 'GERAL'

export const REFRIGERACAO_PRIMARY_OWNER_EMAIL = 'suelemsilva@bemol.com.br'
/** @deprecated Routing PMPL migrado para carteira por fornecedor (pmpl_carteira_fornecedor). Mantido apenas para resolveCurrentPmplOwner (painel de administração). */
export const PMPL_FALLBACK_OWNER_EMAIL = 'gustavoandrade@bemol.com.br'
export const REFRIGERACAO_FALLBACK_GESTOR_EMAILS = [
  'walterrodrigues@bemol.com.br',
  'danieldamasceno@bemol.com.br',
] as const

export const FIXED_OWNER_EMAIL_BY_KEY: Record<FixedOwnerKey, string> = {
  brenda: 'brendafonseca@bemol.com.br',
  adriano: 'adrianobezerra@bemol.com.br',
  duran: 'danielduran@bemol.com.br',
}

export const FIXED_OWNER_LABEL_BY_KEY: Record<FixedOwnerKey, string> = {
  brenda: 'Brenda Rodrigues',
  adriano: 'Adriano Bezerra',
  duran: 'Daniel Duran',
}

const FIXED_OWNER_AVATAR_BY_KEY: Record<FixedOwnerKey, string> = {
  brenda: '/avatars/BRENDA.jpg',
  adriano: '/avatars/ADRIANO.jpg',
  duran: '/avatars/DANIELDURAN.jpg',
}

const FIXED_OWNER_CARD_ORDER: FixedOwnerKey[] = ['brenda', 'duran', 'adriano']

const UNIT_TO_FIXED_OWNER_KEY: Record<string, FixedOwnerKey> = {
  'CD MANAUS': 'brenda',
  'CD TARUMA': 'adriano',
  'CD FARMA TARUMA': 'adriano',
}

const KNOWN_OWNER_CARGO_LABEL_BY_NORMALIZED_NAME: Record<string, KnownOwnerCargoLabel> = {
  'suelem silva': 'REFRIGERACAO',
  'gustavo andrade': 'PREVENTIVAS',
  'brenda rodrigues': 'CD MANAUS',
  'adriano bezerra': 'CD TURISMO',
}

export function normalizeAdminIdentityName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function normalizeAdminEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** @deprecated Ver PMPL_FALLBACK_OWNER_EMAIL. */
export function isPmplFallbackOwnerEmail(value: string | null | undefined): boolean {
  return normalizeAdminEmail(value) === PMPL_FALLBACK_OWNER_EMAIL
}

/** Brenda e Adriano são donos fixos de CD (Manaus/Tarumã).
 *  Eles não recebem distribuição de notas — aparecem apenas no painel de ordens. */
export function isFixedCdOwnerEmail(value: string | null | undefined): boolean {
  const normalizedEmail = normalizeAdminEmail(value)
  return Object.values(FIXED_OWNER_EMAIL_BY_KEY).some((email) => email === normalizedEmail)
}

export function isPmplExceptionOwnerName(value: string | null | undefined): boolean {
  const normalizedName = normalizeAdminIdentityName(value)
  if (!normalizedName) return false
  return normalizedName === 'gustavo andrade' || normalizedName.includes('gustavo')
}

export function isRefrigeracaoFallbackGestorEmail(value: string | null | undefined): boolean {
  const normalizedEmail = normalizeAdminEmail(value)
  return REFRIGERACAO_FALLBACK_GESTOR_EMAILS.some((email) => email === normalizedEmail)
}

export function resolveFixedOwnerKeyByUnit(value: string | null | undefined): FixedOwnerKey | null {
  const normalizedUnit = (value ?? '').trim().toUpperCase()
  if (!normalizedUnit) return null

  const exactMatch = UNIT_TO_FIXED_OWNER_KEY[normalizedUnit]
  if (exactMatch) return exactMatch

  const deaccentedUnit = normalizedUnit.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (deaccentedUnit.includes('MANAUS')) return 'brenda'
  if (deaccentedUnit.includes('TARUMA') || deaccentedUnit.includes('TURISMO')) return 'adriano'

  return null
}

export function resolveFixedOwnerKeyByName(value: string | null | undefined): FixedOwnerKey | null {
  const normalizedName = normalizeAdminIdentityName(value)
  if (!normalizedName) return null

  for (const key of Object.keys(FIXED_OWNER_LABEL_BY_KEY) as FixedOwnerKey[]) {
    const normalizedLabel = normalizeAdminIdentityName(FIXED_OWNER_LABEL_BY_KEY[key])
    if (normalizedName === normalizedLabel || normalizedName.includes(key)) {
      return key
    }
  }

  return null
}

export function resolveFixedOwnerLabelByName(value: string | null | undefined): string | null {
  const key = resolveFixedOwnerKeyByName(value)
  return key ? FIXED_OWNER_LABEL_BY_KEY[key] : null
}

export function resolveFixedOwnerAvatarByName(value: string | null | undefined): string | null {
  const key = resolveFixedOwnerKeyByName(value)
  return key ? FIXED_OWNER_AVATAR_BY_KEY[key] : null
}

export function getFixedOwnerCardRank(value: string | null | undefined): number | undefined {
  const key = resolveFixedOwnerKeyByName(value)
  if (!key) return undefined
  const index = FIXED_OWNER_CARD_ORDER.indexOf(key)
  return index >= 0 ? index : undefined
}

export function shouldHideOwnerOutsidePmpl(value: string | null | undefined): boolean {
  return isPmplExceptionOwnerName(value)
}

export function resolveKnownOwnerCargoLabel(value: string | null | undefined): KnownOwnerCargoLabel | null {
  const normalizedName = normalizeAdminIdentityName(value)
  if (!normalizedName) return null
  return KNOWN_OWNER_CARGO_LABEL_BY_NORMALIZED_NAME[normalizedName] ?? null
}

export function buildFixedOwnerAvatarByAdminId(
  fixedOwnerLabelByAdminId: Map<string, string>
): Map<string, string> {
  const avatarByAdminId = new Map<string, string>()

  for (const [adminId, label] of fixedOwnerLabelByAdminId.entries()) {
    const avatar = resolveFixedOwnerAvatarByName(label)
    if (avatar) avatarByAdminId.set(adminId, avatar)
  }

  return avatarByAdminId
}

export function sortOwnerSummaryByRankAndTotal(rows: OrdersOwnerSummary[]): OrdersOwnerSummary[] {
  return [...rows].sort((a, b) => {
    const aRank = getFixedOwnerCardRank(a.nome)
    const bRank = getFixedOwnerCardRank(b.nome)

    if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank
    if (aRank !== undefined) return -1
    if (bRank !== undefined) return 1
    if (b.total !== a.total) return b.total - a.total
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}
