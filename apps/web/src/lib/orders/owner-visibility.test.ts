import { describe, expect, it } from 'vitest'
import type { OrdersOwnerSummary } from '@/lib/types/database'
import {
  UNASSIGNED_ORDER_OWNER_KEY,
  buildVisibleOwnerSummary,
  hasIndividualOwnerSelection,
  toOrderOwnerKey,
} from '@/lib/orders/owner-visibility'

const OWNER_SUMMARY_FIXTURE: OrdersOwnerSummary[] = [
  {
    administrador_id: 'owner-brenda',
    nome: 'Brenda Rodrigues',
    avatar_url: null,
    total: 0,
    abertas: 0,
    recentes: 0,
    atencao: 0,
    atrasadas: 0,
  },
  {
    administrador_id: 'owner-adriano',
    nome: 'Adriano Bezerra',
    avatar_url: null,
    total: 0,
    abertas: 0,
    recentes: 0,
    atencao: 0,
    atrasadas: 0,
  },
  {
    administrador_id: 'owner-carlos',
    nome: 'Carlos Lima',
    avatar_url: null,
    total: 5,
    abertas: 4,
    recentes: 2,
    atencao: 2,
    atrasadas: 1,
  },
  {
    administrador_id: 'owner-gustavo',
    nome: 'Gustavo Andrade',
    avatar_url: null,
    total: 3,
    abertas: 3,
    recentes: 1,
    atencao: 1,
    atrasadas: 1,
  },
  {
    administrador_id: null,
    nome: 'Sem responsavel',
    avatar_url: null,
    total: 1,
    abertas: 1,
    recentes: 0,
    atencao: 0,
    atrasadas: 1,
  },
]

function getFixedOwnerCardRank(ownerName: string): number | undefined {
  if (ownerName === 'Brenda Rodrigues') return 0
  if (ownerName === 'Adriano Bezerra') return 1
  return undefined
}

function isGustavoOwnerName(ownerName: string): boolean {
  return ownerName.toLowerCase().includes('gustavo')
}

function toOwnerKeys(rows: OrdersOwnerSummary[]): string[] {
  return rows.map((item) => toOrderOwnerKey(item.administrador_id))
}

describe('owner-visibility', () => {
  it('detects individual owner selection only for global scope', () => {
    expect(hasIndividualOwnerSelection(true, 'owner-carlos')).toBe(true)
    expect(hasIndividualOwnerSelection(true, 'todos')).toBe(false)
    expect(hasIndividualOwnerSelection(false, 'owner-carlos')).toBe(false)
  })

  it('keeps Brenda/Adriano pinned in PMOS only when responsavel is todos', () => {
    const visible = buildVisibleOwnerSummary({
      ownerSummary: OWNER_SUMMARY_FIXTURE,
      canViewGlobal: true,
      isPrivateScope: false,
      currentAdminId: 'gestor-id',
      tipoOrdem: 'PMOS',
      responsavel: 'todos',
      isGustavoOwnerName,
      getFixedOwnerCardRank,
    })

    expect(toOwnerKeys(visible)).toEqual([
      'owner-brenda',
      'owner-adriano',
      'owner-carlos',
      UNASSIGNED_ORDER_OWNER_KEY,
    ])
  })

  it('shows only selected owner in PMOS when filtering by another admin', () => {
    const visible = buildVisibleOwnerSummary({
      ownerSummary: OWNER_SUMMARY_FIXTURE,
      canViewGlobal: true,
      isPrivateScope: false,
      currentAdminId: 'gestor-id',
      tipoOrdem: 'PMOS',
      responsavel: 'owner-carlos',
      isGustavoOwnerName,
      getFixedOwnerCardRank,
    })

    expect(toOwnerKeys(visible)).toEqual(['owner-carlos'])
  })

  it('keeps selected fixed owner visible even with zero orders', () => {
    const visible = buildVisibleOwnerSummary({
      ownerSummary: OWNER_SUMMARY_FIXTURE,
      canViewGlobal: true,
      isPrivateScope: false,
      currentAdminId: 'gestor-id',
      tipoOrdem: 'PMOS',
      responsavel: 'owner-brenda',
      isGustavoOwnerName,
      getFixedOwnerCardRank,
    })

    expect(toOwnerKeys(visible)).toEqual(['owner-brenda'])
  })

  it('does not pin fixed owners on PMPL tab', () => {
    const visible = buildVisibleOwnerSummary({
      ownerSummary: OWNER_SUMMARY_FIXTURE,
      canViewGlobal: true,
      isPrivateScope: false,
      currentAdminId: 'gestor-id',
      tipoOrdem: 'PMPL',
      responsavel: 'todos',
      isGustavoOwnerName,
      getFixedOwnerCardRank,
    })

    expect(toOwnerKeys(visible)).toEqual([
      'owner-carlos',
      'owner-gustavo',
      UNASSIGNED_ORDER_OWNER_KEY,
    ])
  })

  it('does not pin fixed owners in private scope', () => {
    const visible = buildVisibleOwnerSummary({
      ownerSummary: OWNER_SUMMARY_FIXTURE,
      canViewGlobal: false,
      isPrivateScope: true,
      currentAdminId: 'owner-carlos',
      tipoOrdem: 'PMOS',
      responsavel: 'todos',
      isGustavoOwnerName,
      getFixedOwnerCardRank,
    })

    expect(toOwnerKeys(visible)).toEqual(['owner-carlos'])
  })
})
