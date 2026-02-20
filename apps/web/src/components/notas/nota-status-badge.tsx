import { Badge } from '@/components/ui/badge'
import type { NotaStatus } from '@/lib/types/database'

const statusConfig: Record<NotaStatus, { label: string; variant: 'nova' | 'em_andamento' | 'encaminhada' | 'concluida' | 'cancelada' }> = {
  nova: { label: 'Nova', variant: 'nova' },
  em_andamento: { label: 'Em Andamento', variant: 'em_andamento' },
  encaminhada_fornecedor: { label: 'Encaminhada', variant: 'encaminhada' },
  concluida: { label: 'Concluída', variant: 'concluida' },
  cancelada: { label: 'Cancelada', variant: 'cancelada' },
}

export function NotaStatusBadge({ status }: { status: NotaStatus }) {
  const config = statusConfig[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
