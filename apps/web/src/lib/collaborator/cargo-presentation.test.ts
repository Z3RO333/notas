import {
  getCargoPresentationByLabel,
  isGustavoOwnerName,
  resolveCargoLabelFromEspecialidade,
  resolveCargoLabelFromOwner,
} from '@/lib/collaborator/cargo-presentation'
import { describe, expect, it } from 'vitest'

describe('cargo-presentation', () => {
  it('resolve especialidade mapping with PREVENTIVAS for elevadores', () => {
    expect(resolveCargoLabelFromEspecialidade('refrigeracao')).toBe('REFRIGERAÇÃO')
    expect(resolveCargoLabelFromEspecialidade('elevadores')).toBe('PREVENTIVAS')
    expect(resolveCargoLabelFromEspecialidade('cd_manaus')).toBe('CD MANAUS')
    expect(resolveCargoLabelFromEspecialidade('cd_taruma')).toBe('CD TURISMO')
    expect(resolveCargoLabelFromEspecialidade('geral')).toBe('GERAL')
  })

  it('uses GERAL fallback for unknown especialidade', () => {
    expect(resolveCargoLabelFromEspecialidade('qualquer-coisa')).toBe('GERAL')
    expect(resolveCargoLabelFromEspecialidade(null)).toBe('GERAL')
  })

  it('resolves SEM RESPONSÁVEL when owner is missing', () => {
    expect(resolveCargoLabelFromOwner({ administrador_id: null, nome: null })).toBe('SEM RESPONSÁVEL')
    expect(resolveCargoLabelFromOwner({ administrador_id: '__sem_atual__', nome: 'Sem responsável atual' })).toBe('SEM RESPONSÁVEL')
  })

  it('resolves fixed and exception owner names', () => {
    expect(resolveCargoLabelFromOwner({ administrador_id: '1', nome: 'Brenda Rodrigues' })).toBe('CD MANAUS')
    expect(resolveCargoLabelFromOwner({ administrador_id: '2', nome: 'Adriano Bezerra' })).toBe('CD TURISMO')
    expect(resolveCargoLabelFromOwner({ administrador_id: '3', nome: 'Suelem Silva' })).toBe('REFRIGERAÇÃO')
    expect(resolveCargoLabelFromOwner({ administrador_id: '4', nome: 'Gustavo Andrade' })).toBe('PREVENTIVAS')
    expect(resolveCargoLabelFromOwner({ administrador_id: '5', nome: 'Paula Souza' })).toBe('GERAL')
    expect(resolveCargoLabelFromOwner({ administrador_id: '6', nome: 'Fulano' })).toBe('GERAL')
  })

  it('exposes cargo presentation metadata with icon and badge class', () => {
    const presentation = getCargoPresentationByLabel('PREVENTIVAS')
    expect(presentation.label).toBe('PREVENTIVAS')
    expect(presentation.iconKey).toBe('wrench')
    expect(presentation.badgeClassName).toContain('bg-lime-100')
  })

  it('detects gustavo owner names for PMOS hiding rule', () => {
    expect(isGustavoOwnerName('Gustavo Andrade')).toBe(true)
    expect(isGustavoOwnerName('GUSTAVO')).toBe(true)
    expect(isGustavoOwnerName('Brenda Rodrigues')).toBe(false)
  })
})
