import {
  isPmplExceptionOwnerName,
  normalizeAdminIdentityName,
  resolveFixedOwnerKeyByName,
  resolveKnownOwnerCargoLabel,
} from '@/lib/admin/admin-identity-catalog'
import type { Especialidade } from '@/lib/types/database'

const REFRIGERACAO_LABEL = 'REFRIGERA\u00c7\u00c3O'
const SEM_RESPONSAVEL_LABEL = 'SEM RESPONS\u00c1VEL'

export type CollaboratorCargoLabel =
  | 'PREVENTIVAS'
  | typeof REFRIGERACAO_LABEL
  | 'CD MANAUS'
  | 'CD TURISMO'
  | 'CRÍTICOS'
  | 'GERAL'
  | typeof SEM_RESPONSAVEL_LABEL

export type CollaboratorCargoIconKey =
  | 'wrench'
  | 'snowflake'
  | 'building'
  | 'warehouse'
  | 'flame'
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
  [REFRIGERACAO_LABEL]: {
    badgeClassName: 'bg-cyan-100 text-cyan-800',
    iconKey: 'snowflake',
  },
  'CD MANAUS': {
    badgeClassName: 'bg-blue-100 text-blue-800',
    iconKey: 'building',
  },
  'CD TURISMO': {
    badgeClassName: 'bg-blue-100 text-blue-800',
    iconKey: 'warehouse',
  },
  'CRÍTICOS': {
    badgeClassName: 'bg-red-100 text-red-800',
    iconKey: 'flame',
  },
  GERAL: {
    badgeClassName: 'bg-gray-100 text-gray-800',
    iconKey: 'users',
  },
  [SEM_RESPONSAVEL_LABEL]: {
    badgeClassName: 'bg-orange-100 text-orange-800',
    iconKey: 'user-x',
  },
}

function normalizeEspecialidade(value: string | null | undefined): Especialidade | 'unknown' {
  if (
    value === 'refrigeracao'
    || value === 'elevadores'
    || value === 'geral'
    || value === 'cd_manaus'
    || value === 'cd_manaus_equip'
    || value === 'cd_taruma'
    || value === 'criticos'
  ) {
    return value
  }

  return 'unknown'
}

function toCollaboratorCargoLabel(value: string | null): CollaboratorCargoLabel | null {
  switch (value) {
    case 'REFRIGERACAO':
      return REFRIGERACAO_LABEL
    case 'PREVENTIVAS':
    case 'CD MANAUS':
    case 'CD TURISMO':
    case 'GERAL':
      return value
    default:
      return null
  }
}

export function normalizePersonName(value: string | null | undefined): string {
  return normalizeAdminIdentityName(value)
}

export function isSyntheticUnassignedOwnerId(ownerId: string | null | undefined): boolean {
  const normalizedId = (ownerId ?? '').trim().toLowerCase()
  if (!normalizedId) return true
  return normalizedId.startsWith('__sem_')
}

export function isGustavoOwnerName(ownerName: string | null | undefined): boolean {
  return isPmplExceptionOwnerName(ownerName)
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
      return REFRIGERACAO_LABEL
    case 'elevadores':
      return 'PREVENTIVAS'
    case 'cd_manaus':
    case 'cd_manaus_equip':
      return 'CD MANAUS'
    case 'cd_taruma':
      return 'CD TURISMO'
    case 'criticos':
      return 'CRÍTICOS'
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
  especialidade?: string | null
}

export function resolveCargoLabelFromOwner(owner: OwnerCargoInput): CollaboratorCargoLabel {
  if (isSyntheticUnassignedOwnerId(owner.administrador_id) || isUnassignedOwnerName(owner.nome)) {
    return SEM_RESPONSAVEL_LABEL
  }

  const fromEspecialidade = resolveCargoLabelFromEspecialidade(owner.especialidade)
  if (fromEspecialidade !== 'GERAL') return fromEspecialidade

  const fixedOwnerKey = resolveFixedOwnerKeyByName(owner.nome)
  if (fixedOwnerKey === 'brenda') return 'CD MANAUS'
  if (fixedOwnerKey === 'adriano') return 'CD TURISMO'

  const knownLabel = toCollaboratorCargoLabel(resolveKnownOwnerCargoLabel(owner.nome))
  if (knownLabel) return knownLabel

  return 'GERAL'
}

export function resolveCargoPresentationFromOwner(owner: OwnerCargoInput): CollaboratorCargoPresentation {
  return getCargoPresentationByLabel(resolveCargoLabelFromOwner(owner))
}
