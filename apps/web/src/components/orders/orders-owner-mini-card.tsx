import { Card } from '@/components/ui/card'
import type { OrderOwnerGroup } from '@/lib/types/database'

interface OrdersOwnerMiniCardProps {
  group: OrderOwnerGroup
  isExpanded: boolean
  onClick: () => void
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function OrdersOwnerMiniCard({
  group,
  isExpanded,
  onClick,
}: OrdersOwnerMiniCardProps) {
  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer p-3 transition-all hover:shadow-md ${
        isExpanded ? 'ring-2 ring-primary bg-primary/5' : ''
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {getInitials(group.nome)}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.nome}</p>
          <p className="text-[10px] text-muted-foreground">
            {group.total} ordem{group.total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        <span className="flex-1 rounded bg-emerald-50 py-0.5 text-center text-xs font-bold text-emerald-700">
          {group.recentes}
        </span>
        <span className="flex-1 rounded bg-amber-50 py-0.5 text-center text-xs font-bold text-amber-700">
          {group.atencao}
        </span>
        <span className="flex-1 rounded bg-red-50 py-0.5 text-center text-xs font-bold text-red-700">
          {group.atrasadas}
        </span>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>0-2d</span>
        <span>3-6d</span>
        <span>7+d</span>
      </div>
    </Card>
  )
}
