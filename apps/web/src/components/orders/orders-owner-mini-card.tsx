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
        <div className="relative shrink-0">
          <Avatar src={group.avatar_url} nome={group.nome} size="md" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.nome}</p>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              {group.total} ordens
            </span>
          </div>
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

      <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
        {group.abertas} ordens abertas
      </div>
    </Card>
  )
}
