import type { CurrentAdminContext } from '@/lib/auth/current-admin-context'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { NotaLookupBanner } from '@/components/notas/nota-lookup-banner'
import { NotasKpiStrip } from '@/components/notas/notas-kpi-strip'
import {
  getNotesPanelData,
  type NotesPageSearchParams,
} from '@/lib/notes/get-notes-panel-data'

interface NotesPanelPageContentProps {
  searchParams?: NotesPageSearchParams
  currentAdminContext: Pick<CurrentAdminContext, 'adminId' | 'role' | 'canViewGlobal'>
}

export async function NotesPanelPageContent({
  searchParams,
  currentAdminContext,
}: NotesPanelPageContentProps) {
  const notesPanelData = await getNotesPanelData({
    searchParams,
    currentAdminContext,
  })

  return (
    <>
      <NotasKpiStrip
        total={notesPanelData.kpis.total}
        novas={notesPanelData.kpis.novas}
        umDia={notesPanelData.kpis.umDia}
        doisMais={notesPanelData.kpis.doisMais}
        activeKpi={notesPanelData.activeNotesKpi}
      />

      {notesPanelData.lookupNota !== null ? (
        <NotaLookupBanner lookupNota={notesPanelData.lookupNota} />
      ) : null}

      <CollaboratorPanel
        collaborators={notesPanelData.collaborators}
        notas={notesPanelData.notasAtribuidas}
        notasSemAtribuir={notesPanelData.canViewGlobal ? notesPanelData.notasSemAtribuir : undefined}
        mode="viewer"
        currentAdminId={notesPanelData.currentAdminId}
        currentAdminRole={notesPanelData.currentAdminRole}
        syncWithUrl
        initialSearch={notesPanelData.initialSearch}
        initialStatus={notesPanelData.initialStatus}
        initialResponsavel={notesPanelData.initialResponsavel}
        initialUnidade={notesPanelData.initialUnidade}
        responsavelOptions={notesPanelData.responsavelOptions}
        unidadeOptions={notesPanelData.unidadeOptions}
        showResponsavelFilter={notesPanelData.canViewGlobal}
        showUnidadeFilter
        statusScope="open_only"
        activeNotesKpi={notesPanelData.activeNotesKpi}
      />
    </>
  )
}
