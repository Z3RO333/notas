import 'server-only'

import { cookies } from 'next/headers'
import { MVIEW_COOKIE_NAME, resolveMaintainerViewFromCookie } from '@/lib/auth/maintainer-view'
import {
  getCurrentAdminContextFromSupabase,
  type CurrentAdminContext,
  type ServerSupabaseClient,
} from '@/lib/auth/current-admin-context'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/database'

export interface RequestAdminContext extends CurrentAdminContext {
  actualRole: UserRole | null
  effectiveRole: UserRole | null
  maintainerViewActive: boolean
}

interface GetCurrentRequestAdminContextOptions {
  supabase?: ServerSupabaseClient
  allowMaintainerView?: boolean
}

export async function getCurrentRequestAdminContext(
  options: GetCurrentRequestAdminContextOptions = {},
): Promise<RequestAdminContext> {
  const supabase = options.supabase ?? await createClient()
  const currentAdminContext = await getCurrentAdminContextFromSupabase(supabase)
  const actualRole = currentAdminContext.role

  let effectiveRole = actualRole
  let maintainerViewActive = false

  if (options.allowMaintainerView && currentAdminContext.email) {
    const cookieStore = await cookies()
    const cookieValue = cookieStore.get(MVIEW_COOKIE_NAME)?.value
    const overrideRole = resolveMaintainerViewFromCookie(
      cookieValue,
      currentAdminContext.email,
      process.env.MAINTAINER_SESSION_SECRET,
    )

    if (overrideRole) {
      effectiveRole = overrideRole
      maintainerViewActive = overrideRole !== actualRole
    }
  }

  return {
    ...currentAdminContext,
    role: effectiveRole,
    actualRole,
    effectiveRole,
    isGestor: effectiveRole === 'gestor',
    canViewGlobal: effectiveRole === 'gestor' || effectiveRole === 'viewer',
    maintainerViewActive,
  }
}
