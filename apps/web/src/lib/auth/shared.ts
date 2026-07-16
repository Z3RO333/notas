import type { UserRole } from '@/lib/types/database'

const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'bemol.com.br').toLowerCase()

export const BEMOL_EMAIL_DOMAIN = `@${ALLOWED_EMAIL_DOMAIN}`

function buildMaintainerEmails(): ReadonlySet<string> {
  const raw = process.env.MAINTAINER_EMAILS ?? ''
  if (!raw.trim()) return new Set()
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
}

export const MAINTAINER_EMAILS: ReadonlySet<string> = buildMaintainerEmails()

export type AuthRedirectErrorCode = 'auth' | 'unauthorized' | 'inactive' | 'conflict'

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isMaintainerEmail(value: string | null | undefined): boolean {
  if (!value) return false
  return MAINTAINER_EMAILS.has(normalizeEmail(value))
}

export function isBemolEmail(value: string): boolean {
  const normalized = normalizeEmail(value)
  return normalized.endsWith(BEMOL_EMAIL_DOMAIN) && normalized.length > BEMOL_EMAIL_DOMAIN.length
}

export function isAllowedAuthRole(role: string | null | undefined): role is UserRole {
  return role === 'admin' || role === 'gestor' || role === 'viewer' || role === 'operacional'
}

export function mapRedirectErrorMessage(code: string | null): string {
  if (code === 'unauthorized') {
    return 'Seu email nao esta autorizado para acessar o cockpit.'
  }
  if (code === 'inactive') {
    return 'Seu acesso esta desativado. Contate o gestor.'
  }
  if (code === 'conflict') {
    return 'Conflito de conta detectado. Contate o gestor.'
  }
  if (code === 'auth') {
    return 'Nao foi possivel concluir a autenticacao. Tente novamente.'
  }
  return ''
}
