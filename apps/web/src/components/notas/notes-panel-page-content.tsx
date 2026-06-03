import { Suspense } from 'react'
import type { CurrentAdminContext } from '@/lib/auth/current-admin-context'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getNotesPanelListData,
  getNotesPanelListBaseData,
  getNotesPanelSummaryData,
  loadNotesPanelSupportingData,
  type NotesPageSearchParams,
} from '@/lib/notes/get-notes-panel-data'
import { NotesPanelListSection } from '@/components/notas/notes-panel-list-section'
import { NotesPanelSummarySection } from '@/components/notas/notes-panel-summary-section'

interface NotesPanelPageContentProps {
  searchParams?: NotesPageSearchParams
  currentAdminContext: Pick<CurrentAdminContext, 'adminId' | 'role' | 'canViewGlobal'>
}

function NotesPanelSummaryFallback() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-32 rounded-full" />
        ))}
      </div>

      <div className="rounded-lg border border-border/60 bg-card/60 px-4 py-3">
        <Skeleton className="h-4 w-72" />
      </div>
    </div>
  )
}

function NotesPanelListFallback() {
  return (
    <div className="space-y-4">
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

export function NotesPanelPageContent({
  searchParams,
  currentAdminContext,
}: NotesPanelPageContentProps) {
  const supportingData = loadNotesPanelSupportingData({
    searchParams,
    currentAdminContext,
  })
  const listBaseData = getNotesPanelListBaseData({
    searchParams,
    currentAdminContext,
    supportingData,
  })

  const summaryPromise = getNotesPanelSummaryData({
    searchParams,
    currentAdminContext,
    supportingData,
    listBaseData,
  })

  const listPromise = getNotesPanelListData({
    searchParams,
    currentAdminContext,
    supportingData,
    listBaseData,
  })

  return (
    <div className="space-y-4">
      <Suspense fallback={<NotesPanelSummaryFallback />}>
        <NotesPanelSummarySection summaryPromise={summaryPromise} />
      </Suspense>

      <Suspense fallback={<NotesPanelListFallback />}>
        <NotesPanelListSection
          summaryPromise={summaryPromise}
          listPromise={listPromise}
        />
      </Suspense>
    </div>
  )
}
