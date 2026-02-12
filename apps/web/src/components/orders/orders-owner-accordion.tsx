import Link from 'next/link'
import { useEffect, useMemo, useRef } from 'react'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
  sortOrdersByPriority,
} from '@/lib/orders/metrics'
import type { OrderOwnerGroup } from '@/lib/types/database'

interface OrdersOwnerAccordionProps {
  group: OrderOwnerGroup
  isOpen: boolean
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

function rowClasses(isSelected: boolean): string {
  const selectedClass = isSelected ? 'border-primary/40 bg-primary/5' : ''
  return `space-y-2 rounded-lg border px-3 py-2.5 ${selectedClass}`
}

export function OrdersOwnerAccordion({
  group,
  isOpen,
  canReassign,
  selectedNotaIds,
  onToggleRowSelection,
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

  const sortedRows = useMemo(() => sortOrdersByPriority(group.rows), [group.rows])

  return (
    <div ref={ref} className="accordion-grid" data-state={isOpen ? 'open' : 'closed'}>
      <div className="accordion-content">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">{group.nome}</h3>
            <span className="text-sm text-muted-foreground">
              {group.total} ordem{group.total !== 1 ? 's' : ''}
            </span>
          </div>

          {sortedRows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma ordem encontrada para este agrupamento.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedRows.map((row) => {
                const rowSelected = selectedNotaIds.has(row.nota_id)

                return (
                  <div key={row.ordem_id} className={rowClasses(rowSelected)}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        {canReassign && (
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border"
                            checked={rowSelected}
                            onChange={() => onToggleRowSelection(row.nota_id)}
                            aria-label={`Selecionar nota ${row.numero_nota}`}
                          />
                        )}

                        <Link
                          href={`/notas/${row.nota_id}`}
                          className="min-w-0 flex-1 rounded-sm transition-colors hover:bg-muted/30"
                        >
                          <p className="font-mono text-sm font-semibold">
                            #{row.numero_nota} • Ordem {row.ordem_codigo}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.descricao ?? 'Sem descricao'}
                          </p>
                        </Link>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                          {getSemaforoLabel(row.semaforo_atraso)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getOrderStatusClass(row.status_ordem)}`}>
                          {getOrderStatusLabel(row.status_ordem)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{row.dias_em_aberto} dia(s) em aberto</span>
                      <span>{row.unidade ?? 'Sem unidade'}</span>
                      <span>Atual: {row.responsavel_atual_nome ?? 'Sem responsavel'}</span>
                      <span>Origem: {row.administrador_nome ?? 'Nao identificado'}</span>
                      <span>
                        Historico: {row.tem_historico ? `${row.qtd_historico} registro(s)` : 'Sem historico'}
                      </span>
                      <span>Detectada em {formatIsoDate(row.ordem_detectada_em)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
