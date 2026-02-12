import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { NotaStatusBadge } from '@/components/notas/nota-status-badge'
import type { OrdemAcompanhamento } from '@/lib/types/database'

interface TrackingOrdersBlockProps {
  orders: OrdemAcompanhamento[]
  title?: string
}

export function TrackingOrdersBlock({
  orders,
  title = 'Minhas ordens em acompanhamento',
}: TrackingOrdersBlockProps) {
  if (orders.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {orders.slice(0, 10).map((order) => (
          <Link
            key={order.acompanhamento_id}
            href={`/notas/${order.nota_id}`}
            className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/30"
          >
            <div className="min-w-0">
              <p className="font-mono font-semibold">#{order.numero_nota}</p>
              <p className="truncate text-xs text-muted-foreground">{order.descricao}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                Ordem {order.ordem_gerada}
              </span>
              <NotaStatusBadge status={order.status} />
            </div>
          </Link>
        ))}
        {orders.length > 10 && (
          <p className="text-center text-xs text-muted-foreground">
            +{orders.length - 10} ordens em acompanhamento
          </p>
        )}
      </CardContent>
    </Card>
  )
}

