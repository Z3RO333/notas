import type { Especialidade } from '@/lib/types/database'

export type CollaboratorCargoLabel =
  | 'PREVENTIVAS'
  | 'REFRIGERAÇÃO'
  | 'CD MANAUS'
  | 'CD TURISMO'
  | 'GERAL'
  | 'SEM RESPONSÁVEL'

export type CollaboratorCargoIconKey =
  | 'wrench'
  | 'snowflake'
  | 'building'
  | 'warehouse'
  | 'users'
  | 'user-x'

export interface CollaboratorCargoPresentation {
  label: CollaboratorCargoLabel
  badgeClassName: string
  iconKey: CollaboratorCargoIconKey
}

const CARGO_PRESENTATION_BY_LABEL: Record<CollaboratorCargoLabel, Omit<CollaboratorCargoPresentation, 'label'>> = {
  PREVENTIVAS: {
    badgeClassName: 'bg-lime-100 text-lime-800',
    iconKey: 'wrench',
  },
  'REFRIGERAÇÃO': {
    badgeClassName: 'bg-cyan-100 text-cyan-800',
    iconKey: 'snowflake',
  },
  'CD MANAUS': {
    badgeClassName: 'bg-blue-100 text-blue-800',
    iconKey: 'building',
  },
  'CD TURISMO': {
    badgeClassName: 'bg-teal-100 text-teal-800',
    iconKey: 'warehouse',
  },
  GERAL: {
    badgeClassName: 'bg-gray-100 text-gray-800',
    iconKey: 'users',
  },
  'SEM RESPONSÁVEL': {
    badgeClassName: 'bg-orange-100 text-orange-800',
    iconKey: 'user-x',
  },
}

const GUSTAVO_OWNER_NAME = 'gustavo andrade'

function normalizeEspecialidade(value: string | null | undefined): Especialidade | 'unknown' {
  if (
    value === 'refrigeracao'
    || value === 'elevadores'
    || value === 'geral'
    || value === 'cd_manaus'
    || value === 'cd_taruma'
  ) {
    return value
  }

  return 'unknown'
}

export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function isSyntheticUnassignedOwnerId(ownerId: string | null | undefined): boolean {
  const normalizedId = (ownerId ?? '').trim().toLowerCase()
  if (!normalizedId) return true
  return normalizedId.startsWith('__sem_')
}

export function isGustavoOwnerName(ownerName: string | null | undefined): boolean {
  const normalizedName = normalizePersonName(ownerName)
  if (!normalizedName) return false
  return normalizedName === GUSTAVO_OWNER_NAME || normalizedName.includes('gustavo')
}

function isUnassignedOwnerName(ownerName: string | null | undefined): boolean {
  const normalizedName = normalizePersonName(ownerName)
  if (!normalizedName) return false
  return normalizedName.includes('sem responsavel') || normalizedName.includes('nao atribu')
}

export function getCargoPresentationByLabel(label: CollaboratorCargoLabel): CollaboratorCargoPresentation {
  const presentation = CARGO_PRESENTATION_BY_LABEL[label]
  return {
    label,
    badgeClassName: presentation.badgeClassName,
    iconKey: presentation.iconKey,
  }
}

export function resolveCargoLabelFromEspecialidade(especialidade: string | null | undefined): CollaboratorCargoLabel {
  const normalizedEspecialidade = normalizeEspecialidade(especialidade)
  switch (normalizedEspecialidade) {
    case 'refrigeracao':
      return 'REFRIGERAÇÃO'
    case 'elevadores':
      return 'PREVENTIVAS'
    case 'cd_manaus':
      return 'CD MANAUS'
    case 'cd_taruma':
      return 'CD TURISMO'
    case 'geral':
    case 'unknown':
    default:
      return 'GERAL'
  }
}

export function resolveCargoPresentationFromEspecialidade(
  especialidade: string | null | undefined
): CollaboratorCargoPresentation {
  return getCargoPresentationByLabel(resolveCargoLabelFromEspecialidade(especialidade))
}

export interface OwnerCargoInput {
  administrador_id: string | null | undefined
  nome: string | null | undefined
}

export function resolveCargoLabelFromOwner(owner: OwnerCargoInput): CollaboratorCargoLabel {
  if (isSyntheticUnassignedOwnerId(owner.administrador_id) || isUnassignedOwnerName(owner.nome)) {
    return 'SEM RESPONSÁVEL'
  }

  const normalizedName = normalizePersonName(owner.nome)
  if (isGustavoOwnerName(normalizedName)) return 'PREVENTIVAS'
  if (normalizedName.includes('adriano')) return 'CD TURISMO'
  if (normalizedName.includes('brenda')) return 'CD MANAUS'
  if (normalizedName.includes('suelem')) return 'REFRIGERAÇÃO'
  if (normalizedName.includes('paula')) return 'GERAL'

  return 'GERAL'
}

export function resolveCargoPresentationFromOwner(owner: OwnerCargoInput): CollaboratorCargoPresentation {
  return getCargoPresentationByLabel(resolveCargoLabelFromOwner(owner))
}
