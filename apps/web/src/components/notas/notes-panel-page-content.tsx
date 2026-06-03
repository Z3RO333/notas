import type { CurrentAdminContext } from '@/lib/auth/current-admin-context'
import {
  getNotesPanelData,
  type NotesPageSearchParams,
} from '@/lib/notes/get-notes-panel-data'
import { NotesPanelClientContent } from '@/components/notas/notes-panel-client-content'

interface NotesPanelPageContentProps {
  searchParams?: NotesPageSearchParams
  currentAdminContext: Pick<CurrentAdminContext, 'adminId' | 'role' | 'canViewGlobal'>
}

function buildInitialQueryString(searchParams?: NotesPageSearchParams): string {
  const params = new URLSearchParams()

  for (const key of ['q', 'status', 'responsavel', 'unidade', 'kpi'] as const) {
    const value = searchParams?.[key]
    if (typeof value === 'string' && value.length > 0) {
      params.set(key, value)
    }
  }

  return params.toString()
}

export async function NotesPanelPageContent({
  searchParams,
  currentAdminContext,
}: NotesPanelPageContentProps) {
  const initialData = await getNotesPanelData({
    searchParams,
    currentAdminContext,
  })

  return (
    <NotesPanelClientContent
      initialData={initialData}
      initialQueryString={buildInitialQueryString(searchParams)}
    />
  )
}
