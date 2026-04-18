import { NotaLookupBanner } from '@/components/notas/nota-lookup-banner'
import { NotasKpiStrip } from '@/components/notas/notas-kpi-strip'
import type { NotesPanelSummaryData } from '@/lib/notes/get-notes-panel-data'

interface NotesPanelSummarySectionProps {
  summaryPromise: Promise<NotesPanelSummaryData>
}

export async function NotesPanelSummarySection({
  summaryPromise,
}: NotesPanelSummarySectionProps) {
  const summary = await summaryPromise

  return (
    <>
      <NotasKpiStrip
        total={summary.kpis.total}
        novas={summary.kpis.novas}
        umDia={summary.kpis.umDia}
        doisMais={summary.kpis.doisMais}
        activeKpi={summary.activeNotesKpi}
      />

      {summary.lookupNota !== null ? (
        <NotaLookupBanner lookupNota={summary.lookupNota} />
      ) : null}
    </>
  )
}
