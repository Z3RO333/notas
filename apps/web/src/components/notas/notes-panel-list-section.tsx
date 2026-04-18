import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import type { NotesPanelListData, NotesPanelSummaryData } from '@/lib/notes/get-notes-panel-data'

interface NotesPanelListSectionProps {
  summaryPromise: Promise<NotesPanelSummaryData>
  listPromise: Promise<NotesPanelListData>
}

export async function NotesPanelListSection({
  summaryPromise,
  listPromise,
}: NotesPanelListSectionProps) {
  const [summary, list] = await Promise.all([summaryPromise, listPromise])

  return (
    <CollaboratorPanel
      collaborators={summary.collaborators}
      notas={list.notasAtribuidas}
      notasSemAtribuir={summary.canViewGlobal ? list.notasSemAtribuir : undefined}
      canonicalUnassignedCollaborator={summary.canViewGlobal ? summary.unassignedCollaborator : null}
      mode="viewer"
      currentAdminId={summary.currentAdminId}
      currentAdminRole={summary.currentAdminRole}
      syncWithUrl
      initialSearch={summary.initialSearch}
      initialStatus={summary.initialStatus}
      initialResponsavel={summary.initialResponsavel}
      initialUnidade={summary.initialUnidade}
      responsavelOptions={summary.responsavelOptions}
      unidadeOptions={summary.unidadeOptions}
      showResponsavelFilter={summary.canViewGlobal}
      showUnidadeFilter
      statusScope="open_only"
      activeNotesKpi={summary.activeNotesKpi}
      preferCanonicalCollaboratorMetrics
      resultsArePartial={list.listIsPartial}
      totalNotesCount={summary.filteredNotesCount}
      loadedNotesCount={list.listLoadedCount}
      operationalStateDegraded={list.operationalStateDegraded}
    />
  )
}
