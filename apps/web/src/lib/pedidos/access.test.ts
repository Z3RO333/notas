import { describe, expect, it } from 'vitest'
import { canAccessPedidos } from './access'

describe('canAccessPedidos', () => {
  it('allows purchase-order roles', () => {
    expect(canAccessPedidos('admin')).toBe(true)
    expect(canAccessPedidos('gestor')).toBe(true)
    expect(canAccessPedidos('viewer')).toBe(true)
  })

  it('rejects operational and missing roles', () => {
    expect(canAccessPedidos('operacional')).toBe(false)
    expect(canAccessPedidos(null)).toBe(false)
  })
})
