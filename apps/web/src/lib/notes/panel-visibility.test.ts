import { shouldIncludePanelNote } from '@/lib/notes/panel-visibility'
import { describe, expect, it } from 'vitest'

const hiddenCdOwnerIds = new Set(['brenda-id', 'adriano-id'])

describe('notes panel visibility', () => {
  it('keeps a CD Manaus note visible when it is assigned to a general admin', () => {
    expect(shouldIncludePanelNote({
      administrador_id: 'general-admin-id',
      centro: '104',
      denominacao_unidade: 'CD MANAUS',
    }, hiddenCdOwnerIds)).toBe(true)
  })

  it.each(['brenda-id', 'adriano-id'])(
    'hides notes assigned to a fixed CD owner (%s)',
    (administradorId) => {
      expect(shouldIncludePanelNote({
        administrador_id: administradorId,
        centro: '104',
        denominacao_unidade: 'CD MANAUS',
      }, hiddenCdOwnerIds)).toBe(false)
    },
  )

  it('keeps the fixed-unit exclusion for unassigned notes', () => {
    expect(shouldIncludePanelNote({
      administrador_id: null,
      centro: '104',
      denominacao_unidade: 'CD MANAUS',
    }, hiddenCdOwnerIds)).toBe(false)
  })

  it('keeps an unassigned non-CD note visible', () => {
    expect(shouldIncludePanelNote({
      administrador_id: null,
      centro: '1001',
      denominacao_unidade: 'LOJA CENTRAL',
    }, hiddenCdOwnerIds)).toBe(true)
  })
})
