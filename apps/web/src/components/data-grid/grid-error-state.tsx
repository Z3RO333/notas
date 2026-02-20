import { Button } from '@/components/ui/button'

interface GridErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function GridErrorState({
  message = 'Não foi possível carregar os dados.',
  onRetry,
}: GridErrorStateProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-6 text-center">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}
