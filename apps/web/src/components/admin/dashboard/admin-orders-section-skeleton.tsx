import { Card } from '@/components/ui/card'

interface AdminOrdersSectionSkeletonProps {
  title: string
  includeRanking?: boolean
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className ?? ''}`} />
}

export function AdminOrdersSectionSkeleton({
  title,
  includeRanking = false,
}: AdminOrdersSectionSkeletonProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="text-xl font-semibold tracking-tight">{title}</div>
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-7 w-40" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="space-y-4 p-6">
            <div className="flex items-start justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-4 w-20" />
          </Card>
        ))}
      </div>

      {includeRanking ? (
        <>
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="space-y-3 p-6 xl:col-span-2">
              <Skeleton className="h-6 w-64" />
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </Card>
            <Card className="space-y-3 p-6">
              <Skeleton className="h-6 w-40" />
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </Card>
          </div>

          <Card className="space-y-3 p-6">
            <Skeleton className="h-6 w-56" />
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </Card>
        </>
      ) : (
        <Card className="space-y-3 p-6">
          <Skeleton className="h-6 w-64" />
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </Card>
      )}
    </section>
  )
}
