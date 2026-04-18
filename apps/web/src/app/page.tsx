import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { NotesPanelPageContent } from '@/components/notas/notes-panel-page-content'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { createClient } from '@/lib/supabase/server'
import type { NotesPageSearchParams } from '@/lib/notes/get-notes-panel-data'

export const dynamic = 'force-dynamic'

interface NotesPageProps {
  searchParams?: Promise<NotesPageSearchParams>
}

export default async function NotesPanelPage({ searchParams }: NotesPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const supabase = await createClient()

  const latestSyncResult = await supabase
    .from('sync_log')
    .select('finished_at, status')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  const latestSync = latestSyncResult.error ? null : (latestSyncResult.data ?? null)

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Notas"
        rightSlot={<LastSyncBadge timestamp={latestSync?.finished_at ?? null} status={latestSync?.status ?? null} />}
      />

      <NotesPanelPageContent
        searchParams={resolvedSearchParams}
        currentAdminContext={{
          adminId: currentAdminContext.adminId,
          role: currentAdminContext.role,
          canViewGlobal: currentAdminContext.canViewGlobal,
        }}
      />

      <RealtimeListener />
    </div>
  )
}
