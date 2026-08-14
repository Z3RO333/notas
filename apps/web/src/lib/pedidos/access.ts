import type { UserRole } from '@/lib/types/database'

const PEDIDOS_ALLOWED_ROLES: ReadonlySet<UserRole> = new Set(['admin', 'gestor', 'viewer'])

export function canAccessPedidos(role: UserRole | null | undefined): boolean {
  return role ? PEDIDOS_ALLOWED_ROLES.has(role) : false
}
