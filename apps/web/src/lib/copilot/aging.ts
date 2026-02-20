import { getAgingDays, isOpenStatus } from '@/lib/collaborator/aging'
import type { NotaPanelData } from '@/lib/types/database'
import type { SmartAgingCategory, SmartAgingBadge, SmartAgingCounts } from '@/lib/types/copilot'

/**
 * Smart Aging — SLA-based categories
 *   dentro_prazo:      0-1 dia  (verde)
 *   perto_de_estourar: 2 dias   (amarelo pulsante)
 *   estourado:         3-4 dias (laranja)
 *   crítico:           5+ dias  (vermelho pulsante)
 */
export function getSmartAgingCategory(
  nota: Pick<NotaPanelData, 'data_criacao_sap' | 'created_at'>,
  now: Date = new Date()
): SmartAgingCategory {
  const days = getAgingDays(nota, now)
  if (days <= 1) return 'dentro_prazo'
  if (days === 2) return 'perto_de_estourar'
  if (days <= 4) return 'estourado'
  return 'critico'
}

const BADGE_MAP: Record<SmartAgingCategory, SmartAgingBadge> = {
  dentro_prazo: {
    label: 'No prazo',
    category: 'dentro_prazo',
    chip: 'bg-emerald-100 text-emerald-700',
    text: 'text-emerald-700',
    pulse: false,
  },
  perto_de_estourar: {
    label: 'Perto do SLA',
    category: 'perto_de_estourar',
    chip: 'bg-amber-100 text-amber-700',
    text: 'text-amber-700',
    pulse: true,
  },
  estourado: {
    label: 'SLA estourado',
    category: 'estourado',
    chip: 'bg-orange-100 text-orange-700',
    text: 'text-orange-700',
    pulse: false,
  },
  critico: {
    label: 'Critico',
    category: 'critico',
    chip: 'bg-red-100 text-red-700',
    text: 'text-red-700',
    pulse: true,
  },
}

export function getSmartAgingBadge(category: SmartAgingCategory): SmartAgingBadge {
  return BADGE_MAP[category]
}

export function buildSmartAgingCounts(notas: NotaPanelData[], now: Date = new Date()): SmartAgingCounts {
  const counts: SmartAgingCounts = {
    dentro_prazo: 0,
    perto_de_estourar: 0,
    estourado: 0,
    critico: 0,
  }

  for (const nota of notas) {
    if (!isOpenStatus(nota.status)) continue
    const cat = getSmartAgingCategory(nota, now)
    counts[cat] += 1
  }

  return counts
}
