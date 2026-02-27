import { describe, expect, it } from 'vitest'
import {
  isAllowedAuthRole,
  isBemolEmail,
  mapLoginErrorMessage,
  mapRedirectErrorMessage,
  mapRegisterErrorMessage,
  normalizeEmail,
} from './shared'

describe('auth shared utils', () => {
  it('normalizes email with trim and lowercase', () => {
    expect(normalizeEmail('  USER@BEMOL.COM.BR ')).toBe('user@bemol.com.br')
  })

  it('accepts only bemol emails', () => {
    expect(isBemolEmail('user@bemol.com.br')).toBe(true)
    expect(isBemolEmail('user@example.com')).toBe(false)
  })

  it('accepts only admin and gestor roles', () => {
    expect(isAllowedAuthRole('admin')).toBe(true)
    expect(isAllowedAuthRole('gestor')).toBe(true)
    expect(isAllowedAuthRole('colab')).toBe(false)
  })

  it('maps login provider errors to user-facing messages', () => {
    expect(mapLoginErrorMessage('Invalid login credentials')).toContain('Email ou senha invalidos')
    expect(mapLoginErrorMessage('Email not confirmed')).toContain('Email nao confirmado')
  })

  it('maps redirect errors to login messages', () => {
    expect(mapRedirectErrorMessage('inactive')).toContain('acesso esta desativado')
    expect(mapRedirectErrorMessage('conflict')).toContain('Conflito de conta')
  })

  it('maps register API errors to first-access messages', () => {
    expect(mapRegisterErrorMessage('UNAUTHORIZED_EMAIL')).toContain('Email nao autorizado')
    expect(mapRegisterErrorMessage('ACCOUNT_ALREADY_ACTIVE')).toContain('ja possui conta')
  })
})
