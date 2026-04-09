import { describe, expect, it } from 'vitest'
import {
  buildPasswordResetRedirectTo,
  PASSWORD_RESET_RECOVERY_PATH,
  resolvePostAuthRedirect,
} from './password-reset'

describe('password-reset helpers', () => {
  it('builds a callback URL that preserves the reset-password destination', () => {
    expect(buildPasswordResetRedirectTo('https://cockpit.bemol.com.br')).toBe(
      'https://cockpit.bemol.com.br/api/auth/callback?next=%2Freset-password%3Ftype%3Drecovery',
    )
  })

  it('prefers a safe next path after auth callback exchange', () => {
    expect(resolvePostAuthRedirect({
      authFlowType: null,
      nextPath: PASSWORD_RESET_RECOVERY_PATH,
    })).toBe(PASSWORD_RESET_RECOVERY_PATH)
  })

  it('falls back to recovery path when next is missing but auth type is recovery', () => {
    expect(resolvePostAuthRedirect({
      authFlowType: 'recovery',
      nextPath: null,
    })).toBe(PASSWORD_RESET_RECOVERY_PATH)
  })

  it('ignores unsafe next paths to avoid open redirects', () => {
    expect(resolvePostAuthRedirect({
      authFlowType: null,
      nextPath: 'https://malicious.example.com',
    })).toBe('/api/auth/landing')

    expect(resolvePostAuthRedirect({
      authFlowType: null,
      nextPath: '//malicious.example.com',
    })).toBe('/api/auth/landing')
  })
})
