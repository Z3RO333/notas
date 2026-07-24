import { describe, expect, it } from 'vitest'
import { getRoleLabel, getVisibleLinks } from './cockpit-shell'

describe('CockpitShell role presentation', () => {
  it('limits viewer navigation to notes and orders', () => {
    expect(getVisibleLinks('viewer').map((link) => link.href)).toEqual(['/', '/ordens'])
  })

  it('keeps Pedidos available to operational admins', () => {
    expect(getVisibleLinks('admin').map((link) => link.href)).toContain('/pedidos')
  })

  it('labels viewer accounts without presenting them as admins', () => {
    expect(getRoleLabel('viewer')).toBe('Visualizador')
  })
})
