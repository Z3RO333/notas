import { Card } from '@/components/ui/card'

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className ?? ''}`} />
}

export default function GestorLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-6 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>

      {/* Chart + SyncHealth */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-6 space-y-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-80 w-full" />
        </Card>
        <Card className="p-6 space-y-4">
          <Skeleton className="h-5 w-36" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      </div>

      {/* Distribution grid */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-5 flex flex-col items-center gap-3">
              <Skeleton className="h-24 w-24 rounded-full" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <div className="grid grid-cols-3 gap-2 w-full">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-12 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
