import { normalizePersonName } from '@/lib/collaborator/cargo-presentation'

const FIXED_AVATAR_BY_NAME_KEY: Record<string, string> = {
  brenda: '/avatars/BRENDA.jpg',
  'brenda rodrigues': '/avatars/BRENDA.jpg',
  adriano: '/avatars/ADRIANO.jpg',
  'adriano bezerra': '/avatars/ADRIANO.jpg',
}

function sanitizeAvatarUrl(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

export function resolveFixedAvatarByName(name: string | null | undefined): string | null {
  const normalizedName = normalizePersonName(name)
  if (!normalizedName) return null

  const direct = FIXED_AVATAR_BY_NAME_KEY[normalizedName]
  if (direct) return direct

  if (normalizedName.includes('brenda')) return '/avatars/BRENDA.jpg'
  if (normalizedName.includes('adriano')) return '/avatars/ADRIANO.jpg'

  return null
}

export function resolveAvatarUrl(params: {
  name: string | null | undefined
  avatarUrl: string | null | undefined
}): string | null {
  return sanitizeAvatarUrl(params.avatarUrl) ?? resolveFixedAvatarByName(params.name)
}

