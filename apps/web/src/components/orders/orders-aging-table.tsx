'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OrderReassignDialog } from '@/components/orders/order-reassign-dialog'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
  sortOrdersByPriority,
} from '@/lib/orders/metrics'
import type {
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
  UserRole,
} from '@/lib/types/database'

interface OrdersAgingTableProps {
  rows: OrdemNotaAcompanhamento[]
  title?: string
  maxRows?: number
  showAdminColumns?: boolean
  canReassign?: boolean
  reassignTargets?: OrderReassignTarget[]
  currentUserRole?: UserRole | null
}

function formatIsoDate(value: string): string {
  const datePart = value.split('T')[0]
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function OrdersAgingTable({
  rows,
  title = 'Ordens em acompanhamento',
  maxRows = 20,
  showAdminColumns = true,
  canReassign = false,
  reassignTargets = [],
  currentUserRole = null,
}: OrdersAgingTableProps) {
  const sorted = useMemo(
    () => sortOrdersByPriority(rows).slice(0, maxRows),
    [rows, maxRows]
  )

  const canShowReassign = canReassign && currentUserRole === 'gestor'
  const canBulkReassign = canShowReassign && reassignTargets.length > 0

  const [selectedNotaIds, setSelectedNotaIds] = useState<string[]>([])

  const visibleNotaIds = useMemo(
    () => Array.from(new Set(sorted.map((row) => row.nota_id))),
    [sorted]
  )

  useEffect(() => {
    setSelectedNotaIds((prev) => prev.filter((id) => visibleNotaIds.includes(id)))
  }, [visibleNotaIds])

  const allVisibleSelected = visibleNotaIds.length > 0
    && visibleNotaIds.every((id) => selectedNotaIds.includes(id))

  function toggleRowSelection(notaId: string) {
    setSelectedNotaIds((prev) => (
      prev.includes(notaId)
        ? prev.filter((id) => id !== notaId)
        : [...prev, notaId]
    ))
  }

  function toggleSelectAll() {
    setSelectedNotaIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleNotaIds.includes(id))
      }

      const merged = new Set([...prev, ...visibleNotaIds])
      return Array.from(merged)
    })
  }

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          {canBulkReassign && sorted.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
              />
              Selecionar visiveis
            </label>
          )}
        </div>

        {canBulkReassign && selectedNotaIds.length > 0 && (
          <OrdersBulkReassignBar
            selectedNotaIds={selectedNotaIds}
            admins={reassignTargets}
            onClearSelection={() => setSelectedNotaIds([])}
            onReassigned={() => setSelectedNotaIds([])}
          />
        )}
      </CardHeader>

      <CardContent className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ordem encontrada para esta janela.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((row) => {
              const rowSelected = selectedNotaIds.includes(row.nota_id)

              return (
                <div
                  key={row.ordem_id}
                  className={`space-y-2 rounded-lg border px-3 py-2.5 ${rowSelected ? 'border-primary/40 bg-primary/5' : ''}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      {canBulkReassign && (
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border"
                          checked={rowSelected}
                          onChange={() => toggleRowSelection(row.nota_id)}
                          aria-label={`Selecionar nota ${row.numero_nota}`}
                        />
                      )}

                      <Link href={`/notas/${row.nota_id}`} className="min-w-0 flex-1 rounded-sm transition-colors hover:bg-muted/30">
                        <p className="font-mono text-sm font-semibold">{row.numero_nota} • Ordem {row.ordem_codigo}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.descricao ?? 'Sem descricao'}</p>
                      </Link>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                        {getSemaforoLabel(row.semaforo_atraso)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getOrderStatusClass(row.status_ordem)}`}>
                        {getOrderStatusLabel(row.status_ordem)}
                      </span>
                      {canShowReassign && (
                        <OrderReassignDialog
                          notaId={row.nota_id}
                          notaNumero={row.numero_nota}
                          ordemCodigo={row.ordem_codigo}
                          currentAdminId={row.responsavel_atual_id}
                          admins={reassignTargets}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{row.dias_em_aberto} dia(s) em aberto</span>
                    <span>{row.unidade ?? 'Sem unidade'}</span>
                    {showAdminColumns && (
                      <span>
                        Atual: {row.responsavel_atual_nome ?? 'Sem responsavel'}
                      </span>
                    )}
                    {showAdminColumns && (
                      <span>
                        Origem: {row.administrador_nome ?? 'Nao identificado'}
                      </span>
                    )}
                    <span>
                      Historico: {row.tem_historico ? `${row.qtd_historico} registro(s)` : 'Sem historico'}
                    </span>
                    <span>
                      Detectada em {formatIsoDate(row.ordem_detectada_em)}
                    </span>
                  </div>
                </div>
              )
            })}

            {rows.length > maxRows && (
              <p className="text-center text-xs text-muted-foreground">
                +{rows.length - maxRows} ordem(ns) fora da visualizacao atual
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
