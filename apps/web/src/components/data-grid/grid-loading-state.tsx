interface GridLoadingStateProps {
  rows?: number
}

export function GridLoadingState({ rows = 8 }: GridLoadingStateProps) {
  return (
    <div className="rounded-lg border">
      <div className="space-y-2 p-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}
