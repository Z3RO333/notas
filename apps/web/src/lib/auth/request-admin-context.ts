import 'server-only'

import { cookies } from 'next/headers'
import { MVIEW_COOKIE_NAME, resolveMaintainerViewFromCookie } from '@/lib/auth/maintainer-view'
import {
  getCurrentAdminContext,
  type CurrentAdminContext,
} from '@/lib/auth/current-admin-context'
import type { UserRole } from '@/lib/types/database'

export interface RequestAdminContext extends CurrentAdminContext {
  actualRole: UserRole | null
  effectiveRole: UserRole | null
  maintainerViewActive: boolean
}

interface GetCurrentRequestAdminContextOptions {
  allowMaintainerView?: boolean
}

export async function getCurrentRequestAdminContext(
  options: GetCurrentRequestAdminContextOptions = {},
): Promise<RequestAdminContext> {
  const currentAdminContext = await getCurrentAdminContext()
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
