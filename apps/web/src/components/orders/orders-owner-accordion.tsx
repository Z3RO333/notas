import { useEffect, useMemo, useRef } from 'react'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import { sortOrdersByPriority } from '@/lib/orders/metrics'
import type { OrderOwnerGroup, OrderReassignTarget } from '@/lib/types/database'

interface OrdersOwnerAccordionProps {
  group: OrderOwnerGroup
  isOpen: boolean
  canReassign: boolean
  selectedNotaIds: Set<string>
  onToggleRowSelection: (notaId: string) => void
  reassignTargets?: OrderReassignTarget[]
}

export function OrdersOwnerAccordion({
  group,
  isOpen,
  canReassign,
  selectedNotaIds,
  onToggleRowSelection,
  reassignTargets = [],
}: OrdersOwnerAccordionProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && ref.current) {
      const timer = setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const rows = useMemo(() => sortOrdersByPriority(group.rows), [group.rows])
  const allSelected = rows.length > 0 && rows.every((row) => selectedNotaIds.has(row.nota_id))

  function setGroupSelection(nextSelected: boolean) {
    for (const row of rows) {
      const isSelected = selectedNotaIds.has(row.nota_id)
      if (nextSelected && !isSelected) onToggleRowSelection(row.nota_id)
      if (!nextSelected && isSelected) onToggleRowSelection(row.nota_id)
    }
  }

  return (
    <div ref={ref} className="accordion-grid" data-state={isOpen ? 'open' : 'closed'}>
      <div className="accordion-content">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base">{group.nome}</h3>
              <span className="text-sm text-muted-foreground">
                {group.total} ordens
                {group.atrasadas > 0 && (
                  <span className="ml-1 text-red-600">({group.atrasadas} atrasada{group.atrasadas !== 1 ? 's' : ''})</span>
                )}
              </span>
            </div>

            {canReassign && rows.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => setGroupSelection(event.target.checked)}
                  aria-label={`Selecionar ordens de ${group.nome}`}
                />
                Selecionar grupo
              </label>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma ordem encontrada para este agrupamento.</p>
            </div>
          ) : (
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => (
                <OrderCompactCard
                  key={row.ordem_id}
                  row={row}
                  selected={selectedNotaIds.has(row.nota_id)}
                  showCheckbox={canReassign}
                  onToggleSelection={onToggleRowSelection}
                  showReassign={canReassign && reassignTargets.length > 0}
                  reassignProps={{
                    currentAdminId: row.responsavel_atual_id,
                    admins: reassignTargets,
                  }}
                  notaLinkHref={`/notas/${row.nota_id}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
