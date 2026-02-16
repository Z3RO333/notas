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
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-muted-foreground/40" />
      <p className="mt-3 text-sm font-medium text-muted-foreground">{message}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground/70">{description}</p>
      )}
      {onReset && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onReset}>
          {resetLabel}
        </Button>
      )}
    </div>
  )
}
