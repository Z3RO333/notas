import { describe, expect, it } from 'vitest'
import {
  DEV_ORDERS_VIEW_AS_PARAM,
  isMaintainerEmail,
  resolveMaintainerViewRoleOverride,
} from '@/lib/auth/shared'

describe('auth-shared', () => {
  it('recognizes maintainer emails case-insensitively', () => {
    expect(isMaintainerEmail('GUSTAVOANDRADE@bemol.com.br')).toBe(true)
    expect(isMaintainerEmail('outra.pessoa@bemol.com.br')).toBe(false)
  })

  it('only applies developer role override to maintainers', () => {
    expect(resolveMaintainerViewRoleOverride('viewer', 'gustavoandrade@bemol.com.br')).toBe('viewer')
    expect(resolveMaintainerViewRoleOverride('gestor', 'outra.pessoa@bemol.com.br')).toBeNull()
  })

  it('ignores invalid role overrides', () => {
    expect(resolveMaintainerViewRoleOverride('superuser', 'gustavoandrade@bemol.com.br')).toBeNull()
    expect(resolveMaintainerViewRoleOverride(null, 'gustavoandrade@bemol.com.br')).toBeNull()
  })

  it('keeps the orders developer query param stable', () => {
    expect(DEV_ORDERS_VIEW_AS_PARAM).toBe('devViewAs')
  })
})
