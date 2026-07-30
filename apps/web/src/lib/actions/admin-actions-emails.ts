import { normalizeEmail, isBemolEmail } from '@/lib/auth/shared'

export function validarEmailsAdicionais(emails: string[]): string[] {
  const normalizados = emails.map((email) => {
    const trimmed = email.trim()
    if (!trimmed) throw new Error('Email adicional vazio')
    const normalized = normalizeEmail(trimmed)
    if (!isBemolEmail(normalized)) {
      throw new Error('Email deve terminar com @bemol.com.br')
    }
    return normalized
  })
  return Array.from(new Set(normalizados))
}
