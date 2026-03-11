'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CHART_AXIS_TICK,
  CHART_AXIS_TICK_MD,
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
} from '@/components/charts/chart-theme'
import type { FinanceiroEvolucaoMes } from '@/lib/types/database'
import { formatCurrencyBRL, formatCurrencyCompactBRL } from '../financeiro-format'

interface FinanceiroMonthlyChartProps {
  data: FinanceiroEvolucaoMes[]
}

export function FinanceiroMonthlyChart({ data }: FinanceiroMonthlyChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolucao Mensal de Custo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evolucao Mensal de Custo</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} />
              <YAxis tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as FinanceiroEvolucaoMes

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>
                        Realizado:{' '}
                        <span className="font-semibold text-emerald-500">
                          {formatCurrencyBRL(row.realizado)}
                        </span>
                      </p>
                      <p>
                        Previsto pendente:{' '}
                        <span className="font-semibold text-amber-500">
                          {formatCurrencyBRL(row.previsto_pendente)}
                        </span>
                      </p>
                      <p>
                        Total:{' '}
                        <span className="font-semibold text-foreground">
                          {formatCurrencyBRL(row.total)}
                        </span>
                      </p>
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar dataKey="realizado" name="Realizado" stackId="financeiro" fill="#22c55e" radius={[6, 6, 0, 0]} />
              <Bar dataKey="previsto_pendente" name="Previsto pendente" stackId="financeiro" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
