import { isOpenStatus } from '@/lib/collaborator/aging'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData } from '@/lib/types/database'

export function withCollaboratorDisplayMetrics(
  collaborator: CollaboratorData,
  notas: NotaPanelData[],
): CollaboratorData {
  const openNotas = notas.filter((nota) => isOpenStatus(nota.status))
  const aging = buildAgingCounts(openNotas)

  return {
    ...collaborator,
    qtd_nova: openNotas.filter((nota) => nota.status === 'nova').length,
    qtd_em_andamento: openNotas.filter((nota) => nota.status === 'em_andamento').length,
    qtd_encaminhada: openNotas.filter((nota) => nota.status === 'encaminhada_fornecedor').length,
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: openNotas.length,
  }
}
