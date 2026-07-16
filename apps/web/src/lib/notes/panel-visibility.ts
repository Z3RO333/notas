import { resolveFixedOwnerKeyByUnit } from '@/lib/admin/admin-identity-catalog'
import type { NotaPanelData } from '@/lib/types/database'

type PanelNoteVisibilityData = Pick<
  NotaPanelData,
  'administrador_id' | 'centro' | 'denominacao_unidade'
>

function getNotaUnidadeLabel(nota: Pick<NotaPanelData, 'centro' | 'denominacao_unidade'>): string | null {
  const denominacao = nota.denominacao_unidade?.trim()
  if (denominacao) return denominacao

  const centro = nota.centro?.trim()
  return centro || null
}

export function shouldIncludePanelNote(
  nota: PanelNoteVisibilityData,
  hiddenCdOwnerIds: ReadonlySet<string>,
): boolean {
  if (nota.administrador_id) {
    return !hiddenCdOwnerIds.has(nota.administrador_id)
  }

  return resolveFixedOwnerKeyByUnit(getNotaUnidadeLabel(nota)) === null
}
