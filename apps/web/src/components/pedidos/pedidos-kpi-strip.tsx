'use client'

import { BarChart3, CheckCircle2, ListChecks, TrendingUp, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PedidosKpis } from '@/lib/types/pedidos'

interface PedidosKpiStripProps {
  kpis: PedidosKpis
  loading?: boolean
}

function fmtCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function PedidosKpiStrip({ kpis, loading = false }: PedidosKpiStripProps) {
  const cards = [
    {
      id: 'total',
      label: 'Total de pedidos',
      value: fmtCount(kpis.total),
      icon: ListChecks,
      valueClass: 'text-foreground',
    },
    {
      id: 'em_aberto',
      label: 'Em aberto',
      value: fmtCount(kpis.em_aberto),
      icon: BarChart3,
      valueClass: 'text-sky-700 dark:text-sky-300',
    },
    {
      id: 'encerrado',
      label: 'Encerrados',
      value: fmtCount(kpis.encerrado),
      icon: CheckCircle2,
      valueClass: 'text-emerald-700 dark:text-emerald-300',
    },
    {
      id: 'cancelado',
      label: 'Cancelados',
      value: fmtCount(kpis.cancelado),
      icon: XCircle,
      valueClass: 'text-red-600 dark:text-red-400',
    },
    {
      id: 'valor_total',
      label: 'Valor total',
      value: fmtCurrency(kpis.valor_total),
      icon: TrendingUp,
      valueClass: 'text-violet-700 dark:text-violet-300',
    },
  ]

  return (
    <div className="rounded-lg border p-2 border-border">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.id} className="h-full">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="min-h-[2.5rem] flex-1 pr-2 text-sm font-medium leading-tight text-muted-foreground">
                  {item.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading
                  ? <div className="h-9 w-16 animate-pulse rounded bg-muted" />
                  : <p className={`text-3xl font-bold ${item.valueClass}`}>{item.value}</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
