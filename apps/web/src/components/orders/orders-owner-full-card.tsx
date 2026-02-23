import Link from 'next/link'
import { useMemo } from 'react'
import { AlertTriangle, Clock3, TimerReset } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { resolveCargoPresentationFromOwner } from '@/lib/collaborator/cargo-presentation'
import { getSemaforoClass, sortOrdersByPriority } from '@/lib/orders/metrics'
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
  const cargo = resolveCargoPresentationFromOwner({
    administrador_id: group.id,
    nome: group.nome,
    especialidade: group.especialidade ?? null,
  })
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

  const details = (
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
  )

  return (
    <CollaboratorCardShell
      variant="operational"
      name={group.nome}
      avatarUrl={group.avatar_url}
      avatarSize="lg"
      cargo={cargo}
      headerRight={canReassign ? (
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => handleToggleGroupSelection(event.target.checked)}
          />
          Selecionar grupo
        </label>
      ) : null}
      secondaryMetrics={[
        {
          id: 'recentes',
          label: '0-2d',
          value: group.recentes,
          tone: 'success',
          icon: TimerReset,
        },
        {
          id: 'atencao',
          label: '3-6d',
          value: group.atencao,
          tone: 'warning',
          icon: Clock3,
        },
        {
          id: 'atrasadas',
          label: '7+d',
          value: group.atrasadas,
          tone: 'danger',
          icon: AlertTriangle,
        },
      ]}
      summary={(
        <>
          <span className="text-base font-bold text-foreground">{group.total}</span>
          <span> de ordens</span>
        </>
      )}
      details={details}
    />
  )
}
