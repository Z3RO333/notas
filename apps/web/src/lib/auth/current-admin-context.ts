import 'server-only'

import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/database'

export interface CurrentAdminContext {
  user: User | null
  email: string | null
  adminId: string | null
  userName: string | null
  role: UserRole | null
  isAuthenticated: boolean
  isGestor: boolean
  canViewGlobal: boolean
}

function normalizeUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor' || value === 'viewer') return value
  return null
}

const EMPTY_CONTEXT: CurrentAdminContext = {
  user: null,
  email: null,
  adminId: null,
  userName: null,
  role: null,
  isAuthenticated: false,
  isGestor: false,
  canViewGlobal: false,
}

const loadCurrentAdminContext = cache(async (): Promise<CurrentAdminContext> => {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError) {
    console.error('getCurrentAdminContext auth.getUser failed:', userError.message)
    return EMPTY_CONTEXT
  }

  const email = user?.email ?? null
  if (!email) {
    return {
      ...EMPTY_CONTEXT,
      user: user ?? null,
      isAuthenticated: Boolean(user),
    }
  }

  const { data: admin, error: adminError } = await supabase
    .from('administradores')
    .select('id, nome, role')
    .eq('email', email)
    .maybeSingle()

  if (adminError) {
    console.error('getCurrentAdminContext administradores query failed:', adminError.message)
  }

  const role = normalizeUserRole(admin?.role)

  return {
    user: user ?? null,
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
