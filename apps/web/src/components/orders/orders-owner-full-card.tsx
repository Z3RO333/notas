import Link from 'next/link'
import { useMemo } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { getSemaforoClass } from '@/lib/orders/metrics'
import { sortOrdersByPriority } from '@/lib/orders/metrics'
import type { OrderOwnerGroup, OrderReassignTarget } from '@/lib/types/database'

interface OrdersOwnerFullCardProps {
  group: OrderOwnerGroup
  canReassign: boolean
  reassignTargets: OrderReassignTarget[]
  selectedNotaIds: Set<string>
  onToggleRowSelection: (notaId: string) => void
}

export function OrdersOwnerFullCard({
  group,
  canReassign,
  reassignTargets: _reassignTargets,
  selectedNotaIds,
  onToggleRowSelection,
}: OrdersOwnerFullCardProps) {
  const rows = useMemo(() => sortOrdersByPriority(group.rows), [group.rows])
  const rowsWithLinkedNote = rows.filter((row) => {
    const notaId = (row.nota_id ?? '').trim()
    return notaId.length > 0
  })
  const allSelected = rowsWithLinkedNote.length > 0 && rowsWithLinkedNote.every((row) => selectedNotaIds.has(row.nota_id))

  function handleToggleGroupSelection(nextSelected: boolean) {
    for (const row of rowsWithLinkedNote) {
      const isSelected = selectedNotaIds.has(row.nota_id)
      if (nextSelected && !isSelected) onToggleRowSelection(row.nota_id)
      if (!nextSelected && isSelected) onToggleRowSelection(row.nota_id)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar src={group.avatar_url} nome={group.nome} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{group.nome}</p>
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {group.total} ordens
            </span>
          </div>
        </div>

        {canReassign && (
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => handleToggleGroupSelection(event.target.checked)}
            />
            Selecionar grupo
          </label>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-emerald-50 px-2 py-1">
          <p className="text-lg font-bold text-emerald-700">{group.recentes}</p>
          <p className="text-[11px] text-emerald-700">0-2d</p>
        </div>
        <div className="rounded bg-amber-50 px-2 py-1">
          <p className="text-lg font-bold text-amber-700">{group.atencao}</p>
          <p className="text-[11px] text-amber-700">3-6d</p>
        </div>
        <div className="rounded bg-red-50 px-2 py-1">
          <p className="text-lg font-bold text-red-700">{group.atrasadas}</p>
          <p className="text-[11px] text-red-700">7+d</p>
        </div>
      </div>

      <div className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <span className="font-semibold">{group.abertas}</span> ordens abertas
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Ordens distribuídas</p>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ordem em aberto.</p>
        ) : (
          <div className="max-h-[24rem] space-y-1.5 overflow-y-auto pr-1">
            {rows.map((row) => {
              const label = row.ordem_codigo?.trim() ? row.ordem_codigo : `#${row.numero_nota}`
              const notaId = (row.nota_id ?? '').trim() || null
              return (
                notaId ? (
                  <Link
                    key={row.ordem_id}
                    href={`/notas/${notaId}`}
                    className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate font-mono font-medium">
                      {label}
                      {row.unidade?.trim() && (
                        <span className="ml-1.5 font-normal text-muted-foreground">· {row.unidade}</span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                      {row.dias_em_aberto}d
                    </span>
                  </Link>
                ) : (
                  <div
                    key={row.ordem_id}
                    className="flex items-center justify-between gap-2 rounded border border-dashed border-amber-300 bg-amber-50/40 px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate font-mono font-medium">
                      {label}
                      <span className="ml-1.5 inline-flex rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Sem nota
                      </span>
                      {row.unidade?.trim() && (
                        <span className="ml-1.5 font-normal text-muted-foreground">· {row.unidade}</span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                      {row.dias_em_aberto}d
                    </span>
                  </div>
                )
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
