'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { NotaLookupBanner } from '@/components/notas/nota-lookup-banner'
import { NotasKpiStrip } from '@/components/notas/notas-kpi-strip'
import type { NotesPanelPageData } from '@/lib/notes/get-notes-panel-data'

interface NotesPanelClientContentProps {
  initialData: NotesPanelPageData
  initialQueryString: string
}

async function fetchNotesPanelData(queryString: string, signal: AbortSignal): Promise<NotesPanelPageData> {
  const res = await fetch(`/api/notas/panel${queryString ? `?${queryString}` : ''}`, {
    signal,
    cache: 'no-store',
  })

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Falha ao carregar painel de notas')
  }

  return res.json() as Promise<NotesPanelPageData>
}

export function NotesPanelClientContent({ initialData, initialQueryString }: NotesPanelClientContentProps) {
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()

  const {
    data = initialData,
    isFetching,
    isPlaceholderData,
    error,
  } = useQuery({
    queryKey: ['notes-panel', queryString],
    queryFn: ({ signal }) => fetchNotesPanelData(queryString, signal),
    initialData: queryString === initialQueryString ? initialData : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  return (
    <div className="space-y-4">
      <NotasKpiStrip
        total={data.kpis.total}
        novas={data.kpis.novas}
        umDia={data.kpis.umDia}
        doisMais={data.kpis.doisMais}
        activeKpi={data.activeNotesKpi}
        useNativeHistorySync
      />

      {data.lookupNota !== null ? (
        <NotaLookupBanner lookupNota={data.lookupNota} />
      ) : null}

      {isFetching && (
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
        </div>
      )}

      {error instanceof Error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      ) : null}

      <div className={isFetching && isPlaceholderData ? 'opacity-80 transition-opacity' : undefined}>
        <CollaboratorPanel
          collaborators={data.collaborators}
          notas={data.notasAtribuidas}
          notasSemAtribuir={data.canViewGlobal ? data.notasSemAtribuir : undefined}
          canonicalUnassignedCollaborator={data.canViewGlobal ? data.unassignedCollaborator : null}
          mode="viewer"
          currentAdminId={data.currentAdminId}
          currentAdminRole={data.currentAdminRole}
          syncWithUrl
          useNativeHistorySync
          initialSearch={data.initialSearch}
          initialStatus={data.initialStatus}
          initialResponsavel={data.initialResponsavel}
          initialUnidade={data.initialUnidade}
          responsavelOptions={data.responsavelOptions}
          unidadeOptions={data.unidadeOptions}
          showResponsavelFilter={data.canViewGlobal}
          statusScope="open_only"
          activeNotesKpi={data.activeNotesKpi}
          preferCanonicalCollaboratorMetrics
          resultsArePartial={data.listIsPartial}
          totalNotesCount={data.filteredNotesCount}
          loadedNotesCount={data.listLoadedCount}
          operationalStateDegraded={data.operationalStateDegraded}
        />
      </div>
    </div>
  )
}
