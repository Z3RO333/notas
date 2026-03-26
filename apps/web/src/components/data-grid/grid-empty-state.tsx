import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GridEmptyStateProps {
  message?: string
  description?: string
  onReset?: () => void
  resetLabel?: string
}

export function GridEmptyState({
  message = 'Nenhum registro encontrado.',
  description,
  onReset,
  resetLabel = 'Limpar filtros',
}: GridEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/40 p-8 text-center sm:p-10">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-semibold">{message}</p>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {onReset ? (
        <Button type="button" variant="outline" size="sm" className="mt-5" onClick={onReset}>
          {resetLabel}
        </Button>
      ) : null}
    </div>
  )
}
