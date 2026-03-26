import { Skeleton } from '@/components/ui/skeleton'

export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <div className="w-full max-w-3xl rounded-3xl border bg-card/60 p-5 shadow-sm sm:p-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Carregando
          </p>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>

        <div className="mt-4 space-y-3">
          <Skeleton className="h-12 rounded-2xl" />
          <Skeleton className="h-12 rounded-2xl" />
          <Skeleton className="h-12 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
