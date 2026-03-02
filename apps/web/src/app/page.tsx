import { Suspense } from 'react'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { NotesPanelPageContent } from '@/components/notas/notes-panel-page-content'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { Card } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import type { NotesPageSearchParams } from '@/lib/notes/get-notes-panel-data'

export const dynamic = 'force-dynamic'

interface NotesPageProps {
  searchParams?: Promise<NotesPageSearchParams>
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className ?? ''}`} />
}

function NotesPanelPageContentFallback() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-32 rounded-full" />
        ))}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-full xl:w-44" />
        <Skeleton className="h-10 w-full xl:w-56" />
        <Skeleton className="h-10 w-full xl:w-48" />
        <Skeleton className="h-10 w-full xl:w-48" />
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="space-y-3 p-4">
            <div className="flex items-start justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
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

      <Suspense fallback={<NotesPanelPageContentFallback />}>
        <NotesPanelPageContent
          searchParams={resolvedSearchParams}
          currentAdminContext={{
            adminId: currentAdminContext.adminId,
            role: currentAdminContext.role,
            canViewGlobal: currentAdminContext.canViewGlobal,
          }}
        />
      </Suspense>

      <RealtimeListener />
    </div>
  )
}
