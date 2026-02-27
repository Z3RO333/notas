import 'server-only'

import type { User } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedAuthRole, isBemolEmail, normalizeEmail } from '@/lib/auth/shared'
import type { UserRole } from '@/lib/types/database'

interface AdministradorAuthRow {
  id: string
  email: string
  role: UserRole
  ativo: boolean
  auth_user_id: string | null
}

type AllowedAdminResult =
  | { ok: true; admin: AdministradorAuthRow }
  | { ok: false; code: 'UNAUTHORIZED_EMAIL' | 'INACTIVE_USER' | 'ROLE_NOT_ALLOWED' }

export type SessionAuthorizationResult =
  | { status: 'authorized'; admin: AdministradorAuthRow }
  | { status: 'unauthorized' | 'inactive' | 'conflict' }

export type FirstAccessResult =
  | { ok: true; email: string; mode: 'created' | 'linked_existing_auth' | 'recovered_link' }
  | {
      ok: false
      code:
        | 'INVALID_DOMAIN'
        | 'INVALID_PASSWORD'
        | 'PASSWORD_MISMATCH'
        | 'UNAUTHORIZED_EMAIL'
        | 'INACTIVE_USER'
        | 'ROLE_NOT_ALLOWED'
        | 'ACCOUNT_ALREADY_ACTIVE'
        | 'EMAIL_CONFLICT'
        | 'INTERNAL_ERROR'
    }

function isNotFoundAuthError(error: { message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false
  if (error.status === 404) return true
  return (error.message ?? '').toLowerCase().includes('user not found')
}

export async function findAdministradorByEmail(email: string): Promise<AdministradorAuthRow | null> {
  const supabase = createAdminClient()
  const normalizedEmail = normalizeEmail(email)
  const { data, error } = await supabase
    .from('administradores')
    .select('id, email, role, ativo, auth_user_id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (error) {
    throw new Error(`Falha ao consultar administradores: ${error.message}`)
  }

  return (data as AdministradorAuthRow | null) ?? null
}

async function getAuthUserById(authUserId: string): Promise<User | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.auth.admin.getUserById(authUserId)

  if (isNotFoundAuthError(error)) {
    return null
  }

  if (error) {
    throw new Error(`Falha ao consultar auth.users por id: ${error.message}`)
  }

  return data.user ?? null
}

async function findAuthUserByEmail(email: string): Promise<User | null> {
  const supabase = createAdminClient()
  const normalizedEmail = normalizeEmail(email)
  const perPage = 200

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) {
      throw new Error(`Falha ao listar usuarios auth: ${error.message}`)
    }

    const users = data.users ?? []
    const match = users.find((user) => normalizeEmail(user.email ?? '') === normalizedEmail)
    if (match) {
      return match
    }

    if (users.length < perPage) {
      break
    }
  }

  return null
}

async function updateAdministradorAuthUserId(
  admin: AdministradorAuthRow,
  authUserId: string,
  options?: { allowOverwriteExistingLink?: boolean }
): Promise<AdministradorAuthRow> {
  if (admin.auth_user_id === authUserId) {
    return admin
  }

  if (admin.auth_user_id && admin.auth_user_id !== authUserId && !options?.allowOverwriteExistingLink) {
    throw new Error('EMAIL_CONFLICT')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('administradores')
    .update({
      auth_user_id: authUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', admin.id)
    .select('id, email, role, ativo, auth_user_id')
    .single()

  if (error) {
    throw new Error(`Falha ao vincular auth_user_id: ${error.message}`)
  }

  return data as AdministradorAuthRow
}

async function validateAllowedAdmin(email: string): Promise<AllowedAdminResult> {
  const admin = await findAdministradorByEmail(email)
  if (!admin) {
    return { ok: false, code: 'UNAUTHORIZED_EMAIL' }
  }
  if (!admin.ativo) {
    return { ok: false, code: 'INACTIVE_USER' }
  }
  if (!isAllowedAuthRole(admin.role)) {
    return { ok: false, code: 'ROLE_NOT_ALLOWED' }
  }
  return { ok: true, admin }
}

export async function authorizeSessionUser(user: Pick<User, 'id' | 'email'>): Promise<SessionAuthorizationResult> {
  const email = normalizeEmail(user.email ?? '')
  if (!email || !isBemolEmail(email)) {
    return { status: 'unauthorized' }
  }

  const allowed = await validateAllowedAdmin(email)
  if (!allowed.ok) {
    if (allowed.code === 'INACTIVE_USER') {
      return { status: 'inactive' }
    }
    return { status: 'unauthorized' }
  }

  const admin = allowed.admin

  if (!admin.auth_user_id) {
    const linkedAdmin = await updateAdministradorAuthUserId(admin, user.id)
    return { status: 'authorized', admin: linkedAdmin }
  }

  if (admin.auth_user_id !== user.id) {
    const linkedAuthUser = await getAuthUserById(admin.auth_user_id)
    if (!linkedAuthUser) {
      const relinkedAdmin = await updateAdministradorAuthUserId(admin, user.id, {
        allowOverwriteExistingLink: true,
      })
      return { status: 'authorized', admin: relinkedAdmin }
    }
    return { status: 'conflict' }
  }

  return { status: 'authorized', admin }
}

export async function provisionFirstAccessUser(params: {
  email: string
  password: string
  confirmPassword: string
}): Promise<FirstAccessResult> {
  const email = normalizeEmail(params.email)
  const password = params.password
  const confirmPassword = params.confirmPassword

  if (!isBemolEmail(email)) {
    return { ok: false, code: 'INVALID_DOMAIN' }
  }

  if (password.length < 6) {
    return { ok: false, code: 'INVALID_PASSWORD' }
  }

  if (password !== confirmPassword) {
    return { ok: false, code: 'PASSWORD_MISMATCH' }
  }

  const allowed = await validateAllowedAdmin(email)
  if (!allowed.ok) {
    return allowed
  }

  const admin = allowed.admin
  const linkedAuthUser = admin.auth_user_id
    ? await getAuthUserById(admin.auth_user_id)
    : null

  if (admin.auth_user_id && linkedAuthUser) {
    return { ok: false, code: 'ACCOUNT_ALREADY_ACTIVE' }
  }

  const existingAuthUser = await findAuthUserByEmail(email)

  if (existingAuthUser) {
    try {
      await updateAdministradorAuthUserId(admin, existingAuthUser.id, {
        allowOverwriteExistingLink: Boolean(admin.auth_user_id && !linkedAuthUser),
      })
      return {
        ok: true,
        email,
        mode: admin.auth_user_id ? 'recovered_link' : 'linked_existing_auth',
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'EMAIL_CONFLICT') {
        return { ok: false, code: 'EMAIL_CONFLICT' }
      }
      throw error
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    const duplicateByRace =
      (error?.message ?? '').toLowerCase().includes('already been registered') ||
      (error?.message ?? '').toLowerCase().includes('already registered')

    if (duplicateByRace) {
      const raceAuthUser = await findAuthUserByEmail(email)
      if (raceAuthUser) {
        try {
          await updateAdministradorAuthUserId(admin, raceAuthUser.id, {
            allowOverwriteExistingLink: Boolean(admin.auth_user_id && !linkedAuthUser),
          })
          return {
            ok: true,
            email,
            mode: admin.auth_user_id ? 'recovered_link' : 'linked_existing_auth',
          }
        } catch (updateError) {
          if (updateError instanceof Error && updateError.message === 'EMAIL_CONFLICT') {
            return { ok: false, code: 'EMAIL_CONFLICT' }
          }
          throw updateError
        }
      }
    }

    return { ok: false, code: 'INTERNAL_ERROR' }
  }

  try {
    await updateAdministradorAuthUserId(admin, data.user.id, {
      allowOverwriteExistingLink: Boolean(admin.auth_user_id && !linkedAuthUser),
    })
  } catch (updateError) {
    if (updateError instanceof Error && updateError.message === 'EMAIL_CONFLICT') {
      return { ok: false, code: 'EMAIL_CONFLICT' }
    }
    throw updateError
  }

  return {
    ok: true,
    email,
    mode: admin.auth_user_id ? 'recovered_link' : 'created',
  }
}
