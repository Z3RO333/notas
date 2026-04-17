import { describe, expect, it } from 'vitest'
import { isMaintainerEmail } from '@/lib/auth/shared'

describe('auth-shared', () => {
  it('recognizes maintainer emails case-insensitively', () => {
    expect(isMaintainerEmail('GUSTAVOANDRADE@bemol.com.br')).toBe(true)
    expect(isMaintainerEmail('outra.pessoa@bemol.com.br')).toBe(false)
  })
})
