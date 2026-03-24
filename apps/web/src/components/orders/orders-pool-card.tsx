'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AlertTriangle, Clock3, Inbox, TimerReset } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { getSemaforoClass, sortOrdersByPriority } from '@/lib/orders/metrics'
import type { OrdersPoolGroup } from '@/lib/types/database'

interface OrdersPoolCardProps {
  group: OrdersPoolGroup
}

function fmt(n: number) {
  return new Intl.NumberFormat('pt-BR').format(n)
}

export function OrdersPoolCard({ group }: OrdersPoolCardProps) {
  const rows = useMemo(() => sortOrdersByPriority(group.rows), [group.rows])

  return (
    <Card className="flex flex-col border-amber-500/40 bg-amber-950/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
              <Inbox className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{group.pool_label}</p>
              <Badge variant="outline" className="mt-0.5 border-amber-500/40 text-xs text-amber-400">
                Fila virtual
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <span className="text-base font-bold text-foreground">{fmt(group.total)}</span>
            <span className="text-xs text-muted-foreground"> ordens</span>
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <TimerReset className="h-3 w-3" />
            {fmt(group.abertas)} abertas
          </span>
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <Clock3 className="h-3 w-3" />
            {fmt(group.atencao)} atenção
          </span>
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertTriangle className="h-3 w-3" />
            {fmt(group.atrasadas)} atrasadas
          </span>
        </div>
      </CardHeader>

      {rows.length > 0 && (
        <CardContent className="flex-1 p-0">
          <p className="px-4 pb-1 text-sm font-semibold text-muted-foreground">Ordens sem responsável</p>
          <div className="max-h-[24rem] space-y-1.5 overflow-y-auto px-4 pb-3 pr-3">
            {rows.map((row) => {
              const label = row.ordem_codigo?.trim() ? row.ordem_codigo : `#${row.numero_nota}`
              const notaId = (row.nota_id ?? '').trim() || null
              return notaId ? (
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
            })}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
