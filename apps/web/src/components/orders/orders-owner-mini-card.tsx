import { Card } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import type { OrderOwnerGroup } from '@/lib/types/database'

interface OrdersOwnerMiniCardProps {
  group: OrderOwnerGroup
  isExpanded: boolean
  onClick: () => void
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
        <Avatar src={group.avatar_url} nome={group.nome} size="md" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.nome}</p>
          <p className="text-[10px] text-muted-foreground">
            {group.total} ordem{group.total !== 1 ? 's' : ''}
            {group.abertas > 0 && ` · ${group.abertas} aberta${group.abertas !== 1 ? 's' : ''}`}
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
        <span>Rec.</span>
        <span>Atenc.</span>
        <span>Atras.</span>
      </div>
    </Card>
  )
}
