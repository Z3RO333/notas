import { describe, expect, it } from 'vitest'
import {
  getSelectedOrderCodes,
  mergeKnownOrderCodes,
  toggleSelectedNotaIds,
  toggleVisibleNotaIds,
} from '@/lib/orders/selection'

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

  it('keeps a cache of known order codes without overwriting with empty values', () => {
    expect(
      mergeKnownOrderCodes(
        { 'nota-a': '5224001' },
        [
          { notaId: 'nota-a', orderCode: '5224001' },
          { notaId: 'nota-b', orderCode: ' 5224002 ' },
          { notaId: 'nota-c', orderCode: '   ' },
        ],
      ),
    ).toEqual({
      'nota-a': '5224001',
      'nota-b': '5224002',
    })
  })

  it('resolves selected order codes in the same selection order without duplicating codes', () => {
    expect(
      getSelectedOrderCodes(
        ['nota-b', 'nota-a', 'nota-c'],
        {
          'nota-a': '5224001',
          'nota-b': '5224002',
          'nota-c': '5224002',
        },
      ),
    ).toEqual(['5224002', '5224001'])
  })
})
