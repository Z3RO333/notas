import 'server-only'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'
import type { UserRole } from '@/lib/types/database'

export interface CurrentAdminContext {
  email: string | null
  adminId: string | null
  userName: string | null
  role: UserRole | null
  isAuthenticated: boolean
  isGestor: boolean
  canViewGlobal: boolean
}

function normalizeUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor' || value === 'viewer' || value === 'operacional') return value
  return null
}

const EMPTY_CONTEXT: CurrentAdminContext = {
  email: null,
  adminId: null,
  userName: null,
  role: null,
  isAuthenticated: false,
  isGestor: false,
  canViewGlobal: false,
}

const loadCurrentAdminContext = cache(async (): Promise<CurrentAdminContext> => {
  const email = await getSessionEmail()
  if (!email) return EMPTY_CONTEXT

  const supabase = createAdminClient()
  const { data: admin, error } = await supabase
    .from('administradores')
    .select('id, nome, role')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    console.error('getCurrentAdminContext administradores query failed:', error.message)
  }

  const role = normalizeUserRole(admin?.role)

  return {
    email,
    adminId: admin?.id ?? null,
    userName: admin?.nome ?? email,
    role,
    isAuthenticated: true,
    isGestor: role === 'gestor',
    canViewGlobal: role === 'gestor' || role === 'viewer',
  }
})

export async function getCurrentAdminContext(): Promise<CurrentAdminContext> {
  return loadCurrentAdminContext()
}
