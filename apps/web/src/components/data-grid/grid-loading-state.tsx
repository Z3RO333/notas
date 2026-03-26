import { Skeleton } from '@/components/ui/skeleton'

interface GridLoadingStateProps {
  rows?: number
}

export function GridLoadingState({ rows = 8 }: GridLoadingStateProps) {
  return (
    <div className="rounded-2xl border bg-card/50 p-3">
      <div className="space-y-2">
        <Skeleton className="h-10 w-48 rounded-xl" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-11 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
