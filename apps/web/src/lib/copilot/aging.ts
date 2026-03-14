import { getAgingDays, isOpenStatus } from '@/lib/collaborator/aging'
import { SLA_DENTRO_PRAZO_MAX_DAYS, SLA_ESTOURADO_MIN_DAYS, SLA_CRITICO_MIN_DAYS } from './sla'
import type { NotaPanelData } from '@/lib/types/database'
import type {
  CopilotAdminNoteStats,
  SmartAgingCategory,
  SmartAgingBadge,
  SmartAgingCounts,
} from '@/lib/types/copilot'

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
  if (days <= SLA_DENTRO_PRAZO_MAX_DAYS) return 'dentro_prazo'
  if (days < SLA_ESTOURADO_MIN_DAYS)     return 'perto_de_estourar'   // = 2 dias
  if (days < SLA_CRITICO_MIN_DAYS)       return 'estourado'           // = 3-4 dias
  return 'critico'                                                     // 5+ dias
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

export function buildAdminNoteStats(
  notas: NotaPanelData[],
  now: Date = new Date(),
): Map<string, CopilotAdminNoteStats> {
  const stats = new Map<string, CopilotAdminNoteStats>()

  for (const nota of notas) {
    if (!nota.administrador_id || !isOpenStatus(nota.status)) continue

    const current = stats.get(nota.administrador_id) ?? {
      administrador_id: nota.administrador_id,
      qtd_abertas: 0,
      qtd_notas_criticas: 0,
      critical_density: 0,
    }

    current.qtd_abertas += 1
    if (getSmartAgingCategory(nota, now) === 'critico') {
      current.qtd_notas_criticas += 1
    }

    stats.set(nota.administrador_id, current)
  }

  for (const entry of stats.values()) {
    entry.critical_density = entry.qtd_abertas > 0
      ? Number(((entry.qtd_notas_criticas / entry.qtd_abertas) * 100).toFixed(1))
      : 0
  }

  return stats
}
