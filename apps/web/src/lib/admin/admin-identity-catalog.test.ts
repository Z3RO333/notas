import {
  buildFixedOwnerAvatarByAdminId,
  getFixedOwnerCardRank,
  isFixedCdOwnerEmail,
  isPmplExceptionOwnerName,
  isRefrigeracaoFallbackGestorEmail,
  normalizeAdminIdentityName,
  resolveFixedOwnerAvatarByName,
  resolveFixedOwnerKeyByUnit,
  resolveFixedOwnerLabelByName,
  sortOwnerSummaryByRankAndTotal,
} from '@/lib/admin/admin-identity-catalog'
import type { OrdersOwnerSummary } from '@/lib/types/database'
import { describe, expect, it } from 'vitest'

function makeOwnerSummary(
  nome: string,
  total: number,
  administradorId: string | null = nome.toLowerCase(),
): OrdersOwnerSummary {
  return {
    administrador_id: administradorId,
    nome,
    avatar_url: null,
    total,
    abertas: total,
    recentes: 0,
    atencao: 0,
    atrasadas: 0,
  }
}

describe('admin-identity-catalog', () => {
  it('normalizes names and resolves fixed owners', () => {
    expect(normalizeAdminIdentityName('  Br\u00eanda Rodr\u00edgues  ')).toBe('brenda rodrigues')
    expect(resolveFixedOwnerKeyByUnit('cd manaus')).toBe('brenda')
    expect(resolveFixedOwnerKeyByUnit('CD MANAUS NORTE')).toBe('brenda')
    expect(resolveFixedOwnerKeyByUnit('CD TARUMÃ')).toBe('adriano')
    expect(resolveFixedOwnerKeyByUnit('CD TURISMO')).toBe('adriano')
    expect(resolveFixedOwnerKeyByUnit('LOJA CENTRAL')).toBe(null)
    expect(resolveFixedOwnerLabelByName('Adriano')).toBe('Adriano Bezerra')
    expect(resolveFixedOwnerAvatarByName('Brenda Rodrigues')).toBe('/avatars/BRENDA.jpg')
    expect(getFixedOwnerCardRank('Brenda Rodrigues')).toBe(0)
    expect(getFixedOwnerCardRank('Adriano Bezerra')).toBe(1)
  })

  it('keeps exception and fallback rules centralized', () => {
    expect(isPmplExceptionOwnerName('Gustavo Andrade')).toBe(true)
    expect(isPmplExceptionOwnerName('Brenda Rodrigues')).toBe(false)
    expect(isFixedCdOwnerEmail('BRENDAFONSECA@bemol.com.br')).toBe(true)
    expect(isFixedCdOwnerEmail('adrianobezerra@bemol.com.br')).toBe(true)
    expect(isFixedCdOwnerEmail('rosanafigueira@bemol.com.br')).toBe(false)
    expect(isRefrigeracaoFallbackGestorEmail('WALTERRODRIGUES@bemol.com.br')).toBe(true)
    expect(isRefrigeracaoFallbackGestorEmail('outro@bemol.com.br')).toBe(false)
  })

  it('builds fixed avatars by admin id and sorts owners with fixed rank first', () => {
    const avatars = buildFixedOwnerAvatarByAdminId(new Map([
      ['1', 'Brenda Rodrigues'],
      ['2', 'Adriano Bezerra'],
      ['3', 'Pessoa Qualquer'],
    ]))

    expect(avatars.get('1')).toBe('/avatars/BRENDA.jpg')
    expect(avatars.get('2')).toBe('/avatars/ADRIANO.jpg')
    expect(avatars.has('3')).toBe(false)

    const sorted = sortOwnerSummaryByRankAndTotal([
      makeOwnerSummary('Pessoa C', 20, '3'),
      makeOwnerSummary('Adriano Bezerra', 1, '2'),
      makeOwnerSummary('Pessoa A', 10, '4'),
      makeOwnerSummary('Brenda Rodrigues', 0, '1'),
    ])

    expect(sorted.map((item) => item.nome)).toEqual([
      'Brenda Rodrigues',
      'Adriano Bezerra',
      'Pessoa C',
      'Pessoa A',
    ])
  })
})
