import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GridErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function GridErrorState({
  message = 'Nao foi possivel carregar os dados.',
  onRetry,
}: GridErrorStateProps) {
  return (
    <div className="rounded-2xl border border-dashed p-8 text-center sm:p-10">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Atualize a tela ou tente novamente.</p>
      {onRetry ? (
        <Button type="button" variant="outline" className="mt-5" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  )
}
