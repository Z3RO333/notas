import { describe, expect, it } from 'vitest'
import { toggleSelectedNotaIds, toggleVisibleNotaIds } from '@/lib/orders/selection'

describe('orders-selection', () => {
  it('toggles one nota id without duplicating it', () => {
    expect(toggleSelectedNotaIds([], 'nota-1')).toEqual(['nota-1'])
    expect(toggleSelectedNotaIds(['nota-1'], 'nota-1')).toEqual([])
    expect(toggleSelectedNotaIds(['nota-1'], 'nota-2')).toEqual(['nota-1', 'nota-2'])
  })

  it('adds visible rows to the existing selection when selecting all loaded', () => {
    expect(toggleVisibleNotaIds(['nota-a'], ['nota-b', 'nota-c'], false)).toEqual(['nota-a', 'nota-b', 'nota-c'])
  })

  it('removes only the currently visible rows when deselecting all loaded', () => {
    expect(toggleVisibleNotaIds(['nota-a', 'nota-b', 'nota-c'], ['nota-b'], true)).toEqual(['nota-a', 'nota-c'])
  })
})
