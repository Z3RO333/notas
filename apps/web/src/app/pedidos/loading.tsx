import { Skeleton } from '@/components/ui/skeleton'

export default function PedidosLoading() {
  return (
    <div className="space-y-5" aria-label="Carregando pedidos de compra">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-xl sm:w-[32rem]" />
        </div>
        <Skeleton className="h-8 w-44" />
      </div>
      <Skeleton className="h-10 w-full max-w-md rounded-full" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
      <div className="space-y-2 rounded-xl border p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
