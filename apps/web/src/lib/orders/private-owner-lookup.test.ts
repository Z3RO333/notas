import { describe, expect, it } from 'vitest'
import {
  isPrivateOwnerLookupActive,
  matchesPrivateOwnerLookupRow,
  normalizePrivateOwnerLookupValue,
} from '@/lib/orders/private-owner-lookup'

describe('private-owner-lookup', () => {
  it('accepts exact numeric lookups and normalizes leading zeros', () => {
    expect(normalizePrivateOwnerLookupValue('563723')).toBe('563723')
    expect(normalizePrivateOwnerLookupValue('000563723')).toBe('563723')
  })

  it('rejects short or non-numeric queries', () => {
    expect(normalizePrivateOwnerLookupValue('1234')).toBeNull()
    expect(normalizePrivateOwnerLookupValue('ordem 563723')).toBeNull()
    expect(isPrivateOwnerLookupActive('ABC123')).toBe(false)
  })

  it('matches rows by ordem or nota even when the stored value has leading zeros', () => {
    const normalizedLookup = normalizePrivateOwnerLookupValue('563723')

    expect(matchesPrivateOwnerLookupRow({
      ordem_codigo: '000563723',
      numero_nota: '100012345',
    }, normalizedLookup)).toBe(true)

    expect(matchesPrivateOwnerLookupRow({
      ordem_codigo: '999999',
      numero_nota: '000563723',
    }, normalizedLookup)).toBe(true)

    expect(matchesPrivateOwnerLookupRow({
      ordem_codigo: '999999',
      numero_nota: '100012345',
    }, normalizedLookup)).toBe(false)
  })
})
