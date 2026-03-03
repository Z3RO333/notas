import { resolveFixedOwnerAvatarByName } from '@/lib/admin/admin-identity-catalog'

function sanitizeAvatarUrl(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

export function resolveAvatarUrl(params: {
  name: string | null | undefined
  avatarUrl: string | null | undefined
}): string | null {
  return sanitizeAvatarUrl(params.avatarUrl) ?? resolveFixedOwnerAvatarByName(params.name)
}
