import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface LastSyncBadgeProps {
  timestamp?: string | null
  status?: string | null
}

export function LastSyncBadge({ timestamp, status }: LastSyncBadgeProps) {
  if (!timestamp) {
    return (
      <span className="inline-flex items-center rounded-full border px-2 py-1 text-xs text-muted-foreground">
        Sem sync recente
      </span>
    )
  }

  const label = formatDistanceToNow(new Date(timestamp), {
    addSuffix: true,
    locale: ptBR,
  })

  const tone = status === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${tone}`}>
      Atualizado {label}
    </span>
  )
}
