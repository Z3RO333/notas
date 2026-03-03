import { getFixedOwnerCardRank, shouldHideOwnerOutsidePmpl } from '@/lib/admin/admin-identity-catalog'
import type { OrdersOwnerSummary } from '@/lib/types/database'

export const UNASSIGNED_ORDER_OWNER_KEY = '__sem_atual__'

export function toOrderOwnerKey(administradorId: string | null | undefined): string {
  const normalized = (administradorId ?? '').trim()
  return normalized || UNASSIGNED_ORDER_OWNER_KEY
}

export function hasIndividualOwnerSelection(
  canViewGlobal: boolean,
  responsavel: string | null | undefined,
): boolean {
  if (!canViewGlobal) return false
  const normalized = (responsavel ?? '').trim()
  return normalized.length > 0 && normalized !== 'todos'
}

interface BuildVisibleOwnerSummaryParams {
  ownerSummary: OrdersOwnerSummary[]
  canViewGlobal: boolean
  isPrivateScope: boolean
  currentAdminId: string
  tipoOrdem: string
  responsavel: string | null | undefined
}

function compareByTotalAndName(
  a: Pick<OrdersOwnerSummary, 'total' | 'nome'>,
  b: Pick<OrdersOwnerSummary, 'total' | 'nome'>,
): number {
  if (b.total !== a.total) return b.total - a.total
  return a.nome.localeCompare(b.nome, 'pt-BR')
}

export function buildVisibleOwnerSummary(params: BuildVisibleOwnerSummaryParams): OrdersOwnerSummary[] {
  const selectionActive = hasIndividualOwnerSelection(params.canViewGlobal, params.responsavel)
  const selectedOwnerKey = selectionActive ? (params.responsavel ?? '').trim() : null
  const shouldPinFixedOwners = params.canViewGlobal && params.tipoOrdem !== 'PMPL' && !selectionActive
  const shouldHideOwner = params.tipoOrdem !== 'PMPL'

  const scopedOwnerSummary = params.isPrivateScope
    ? params.ownerSummary.filter((owner) => owner.administrador_id === params.currentAdminId)
    : params.ownerSummary

  const filtered = scopedOwnerSummary.filter((owner) => {
    if (shouldHideOwner && shouldHideOwnerOutsidePmpl(owner.nome)) return false

    if (selectedOwnerKey) {
      return toOrderOwnerKey(owner.administrador_id) === selectedOwnerKey
    }

    return (
      owner.total > 0
      || owner.administrador_id === null
      || (shouldPinFixedOwners && getFixedOwnerCardRank(owner.nome) !== undefined)
    )
  })

  if (!shouldPinFixedOwners) {
    return [...filtered].sort(compareByTotalAndName)
  }

  return [...filtered].sort((a, b) => {
    const aRank = getFixedOwnerCardRank(a.nome)
    const bRank = getFixedOwnerCardRank(b.nome)

    if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank
    if (aRank !== undefined) return -1
    if (bRank !== undefined) return 1

    return compareByTotalAndName(a, b)
  })
}
