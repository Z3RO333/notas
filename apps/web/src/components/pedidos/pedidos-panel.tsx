'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PedidosAccordion } from '@/components/pedidos/pedidos-accordion'
import { PedidosKpiStrip } from '@/components/pedidos/pedidos-kpi-strip'
import { FornecedoresCarteiraPanel } from '@/components/pedidos/fornecedores-carteira-panel'
import { cn } from '@/lib/utils'
import type { PedidosAdminSummary, PedidosSummaryResponse } from '@/lib/types/pedidos'

type PedidosSubaba = 'pedidos' | 'fornecedores'

const SUBABA_OPTIONS: Array<{ id: PedidosSubaba; label: string }> = [
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'fornecedores', label: 'Carteira de Fornecedores' },
]

function PedidosSubabaToggle({ value, onChange }: { value: PedidosSubaba; onChange: (next: PedidosSubaba) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-full border border-border/60 bg-muted/30 p-1">
      {SUBABA_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            value === option.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function usePedidosSummary() {
  return useQuery<PedidosAdminSummary[]>({
    queryKey: ['pedidos-summary'],
    queryFn: async () => {
      const res = await fetch('/api/pedidos/summary', { cache: 'no-store' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar resumo de pedidos')
      }
      const data = (await res.json()) as PedidosSummaryResponse
      return data.admins
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })
}

interface PedidosPanelProps {
  isGestor: boolean
}

export function PedidosPanel({ isGestor }: PedidosPanelProps) {
  const [subaba, setSubaba] = useState<PedidosSubaba>('pedidos')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: admins, isPending, error } = usePedidosSummary()

  function handleRowClick(adminId: string) {
    setExpandedId((prev) => (prev === adminId ? null : adminId))
  }

  if (subaba === 'fornecedores') {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <FornecedoresCarteiraPanel isGestor={isGestor} />
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <PedidosKpiStrip
          kpis={{ total: 0, em_aberto: 0, encerrado: 0, cancelado: 0, valor_total: 0 }}
          loading
        />
        <Card>
          <CardContent className="p-0">
            <div className="space-y-0">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
                  <Skeleton className="h-4 w-6" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Erro ao carregar pedidos.'}
        </p>
      </div>
    )
  }

  if (!admins || admins.length === 0) {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Nenhum administrador encontrado.
          </CardContent>
        </Card>
      </div>
    )
  }

  const kpis = admins.reduce(
    (acc, a) => ({
      total: acc.total + a.em_aberto + a.encerrado + a.cancelado,
      em_aberto: acc.em_aberto + a.em_aberto,
      encerrado: acc.encerrado + a.encerrado,
      cancelado: acc.cancelado + a.cancelado,
      valor_total: acc.valor_total + a.valor_total,
    }),
    { total: 0, em_aberto: 0, encerrado: 0, cancelado: 0, valor_total: 0 }
  )

  return (
    <div className="space-y-4">
    <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
    <PedidosKpiStrip kpis={kpis} />
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Pedidos por Colaborador
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordenado por pedidos em aberto. Clique em uma linha para ver os pedidos do colaborador.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="w-8 px-3 py-2"><span className="sr-only">Expandir</span></th>
                <th className="w-8 px-2 py-2 text-center font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">Colaborador</th>
                <th className="px-4 py-2 text-right font-medium">Em Aberto</th>
                <th className="px-4 py-2 text-right font-medium">Encerrado</th>
                <th className="px-4 py-2 text-right font-medium">Cancelado</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin, index) => {
                const isExpanded = expandedId === admin.adminId
                const adminTotal = admin.em_aberto + admin.encerrado + admin.cancelado
                const pct = kpis.total > 0 ? ((adminTotal / kpis.total) * 100).toFixed(1) : '0.0'

                return (
                  <Fragment key={admin.adminId}>
                    <tr
                      className="cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/20"
                      onClick={() => handleRowClick(admin.adminId)}
                    >
                      <td className="w-8 px-3 py-3 text-muted-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </td>
                      <td className="w-8 px-2 py-3 text-center text-xs text-muted-foreground">
                        #{index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{admin.nome}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {pct}% dos pedidos
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={
                            admin.em_aberto > 0
                              ? 'font-medium text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {admin.em_aberto.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {admin.encerrado.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={
                            admin.cancelado > 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {admin.cancelado.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {adminTotal.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b bg-muted/5 last:border-0">
                        <td colSpan={7} className="p-0">
                          <PedidosAccordion
                            key={admin.adminId}
                            adminId={admin.adminId}
                            isOpen={true}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    </div>
  )
}
