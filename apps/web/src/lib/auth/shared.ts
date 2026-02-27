import type { UserRole } from '@/lib/types/database'

export const BEMOL_EMAIL_DOMAIN = '@bemol.com.br'

export type AuthRedirectErrorCode = 'auth' | 'unauthorized' | 'inactive' | 'conflict'

export type RegisterErrorCode =
  | 'INVALID_DOMAIN'
  | 'INVALID_PASSWORD'
  | 'PASSWORD_MISMATCH'
  | 'UNAUTHORIZED_EMAIL'
  | 'INACTIVE_USER'
  | 'ROLE_NOT_ALLOWED'
  | 'ACCOUNT_ALREADY_ACTIVE'
  | 'EMAIL_CONFLICT'
  | 'INTERNAL_ERROR'

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isBemolEmail(value: string): boolean {
  const normalized = normalizeEmail(value)
  return normalized.endsWith(BEMOL_EMAIL_DOMAIN) && normalized.length > BEMOL_EMAIL_DOMAIN.length
}

export function isAllowedAuthRole(role: string | null | undefined): role is UserRole {
  return role === 'admin' || role === 'gestor'
}

export function mapLoginErrorMessage(rawMessage: string): string {
  const message = rawMessage.toLowerCase()
  if (message.includes('email not confirmed')) {
    return 'Email nao confirmado. Clique no link de confirmacao enviado para sua caixa de entrada.'
  }
  if (message.includes('invalid login credentials')) {
    return 'Email ou senha invalidos. Se voce pediu recuperacao, abra o link do email e redefina sua senha.'
  }
  return 'Nao foi possivel autenticar agora. Tente novamente.'
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

export function mapRegisterErrorMessage(code: string | null | undefined): string {
  if (code === 'INVALID_DOMAIN') {
    return 'Use seu email @bemol.com.br.'
  }
  if (code === 'INVALID_PASSWORD') {
    return 'A senha deve ter pelo menos 6 caracteres.'
  }
  if (code === 'PASSWORD_MISMATCH') {
    return 'As senhas nao coincidem.'
  }
  if (code === 'UNAUTHORIZED_EMAIL') {
    return 'Email nao autorizado. Contate o gestor.'
  }
  if (code === 'INACTIVE_USER') {
    return 'Seu acesso esta desativado. Contate o gestor.'
  }
  if (code === 'ROLE_NOT_ALLOWED') {
    return 'Este perfil nao pode acessar o cockpit.'
  }
  if (code === 'ACCOUNT_ALREADY_ACTIVE') {
    return 'Este email ja possui conta. Use o login normal.'
  }
  if (code === 'EMAIL_CONFLICT') {
    return 'Nao foi possivel ativar este email. Contate o gestor.'
  }
  return 'Nao foi possivel concluir o primeiro acesso agora. Tente novamente.'
}
