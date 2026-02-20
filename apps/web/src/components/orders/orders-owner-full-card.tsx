import Link from 'next/link'
import { useMemo } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
  sortOrdersByPriority,
} from '@/lib/orders/metrics'
import type { OrderOwnerGroup } from '@/lib/types/database'

interface OrdersOwnerFullCardProps {
  group: OrderOwnerGroup
  canReassign: boolean
  selectedNotaIds: Set<string>
  onToggleRowSelection: (notaId: string) => void
}

function formatIsoDate(value: string): string {
  const datePart = value.split('T')[0]
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function OrdersOwnerFullCard({
  group,
  canReassign,
  selectedNotaIds,
  onToggleRowSelection,
}: OrdersOwnerFullCardProps) {
  const rows = useMemo(() => sortOrdersByPriority(group.rows), [group.rows])
  const allSelected = rows.length > 0 && rows.every((row) => selectedNotaIds.has(row.nota_id))

  function handleToggleGroupSelection(nextSelected: boolean) {
    for (const row of rows) {
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
      </div>

      <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div key={row.ordem_id} className="rounded-lg border px-3 py-2 transition-colors hover:bg-muted/40">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/notas/${row.nota_id}`} className="font-mono text-sm font-semibold hover:underline">
                  {row.numero_nota} • Ordem {row.ordem_codigo}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{row.descricao ?? 'Sem descrição'}</p>
              </div>

              {canReassign && (
                <input
                  type="checkbox"
                  checked={selectedNotaIds.has(row.nota_id)}
                  onChange={() => onToggleRowSelection(row.nota_id)}
                  aria-label={`Selecionar nota ${row.numero_nota}`}
                />
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                {getSemaforoLabel(row.semaforo_atraso)}
              </span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getOrderStatusClass(row.status_ordem)}`}>
                {getOrderStatusLabel(row.status_ordem)}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.dias_em_aberto} dia(s)
              </span>
              <span className="text-xs text-muted-foreground">
                {formatIsoDate(row.ordem_detectada_em)}
              </span>
            </div>

            <div className="mt-1 space-y-0.5 text-xs">
              <p><span className="text-muted-foreground">Atual:</span> {row.responsavel_atual_nome ?? 'Sem responsável'}</p>
              <p><span className="text-muted-foreground">Origem:</span> {row.administrador_nome ?? 'Não identificado'}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
