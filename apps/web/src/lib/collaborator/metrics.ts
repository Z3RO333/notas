import { getAgingBucket, isOpenStatus } from '@/lib/collaborator/aging'
import type { NotesKpiFilter, NotaPanelData } from '@/lib/types/database'

export interface AgingCounts {
  qtd_novo: number
  qtd_1_dia: number
  qtd_2_mais: number
}

export function buildAgingCounts(notas: NotaPanelData[]): AgingCounts {
  let qtdNovo = 0
  let qtd1Dia = 0
  let qtd2Mais = 0

  for (const nota of notas) {
    if (!isOpenStatus(nota.status)) continue
    const bucket = getAgingBucket(nota)
    if (bucket === 'novo') {
      qtdNovo += 1
    } else if (bucket === 'um_dia') {
      qtd1Dia += 1
    } else {
      qtd2Mais += 1
    }
  }

  return {
    qtd_novo: qtdNovo,
    qtd_1_dia: qtd1Dia,
    qtd_2_mais: qtd2Mais,
  }
}

export function matchNotesKpi(nota: NotaPanelData, kpi: NotesKpiFilter): boolean {
  if (!isOpenStatus(nota.status)) return false
  if (kpi === 'notas') return true

  const bucket = getAgingBucket(nota)
  if (kpi === 'novas') return bucket === 'novo'
  if (kpi === 'um_dia') return bucket === 'um_dia'
  return bucket === 'dois_mais'
}
