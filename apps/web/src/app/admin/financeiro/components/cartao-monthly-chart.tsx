'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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
} from '@/components/charts/chart-theme'
import { ChartPercentChangeBarLabel } from '@/components/charts/chart-percent-change-label'
import {
  calculatePercentChange,
  formatSignedPercentChange,
  formatTrendDescription,
} from '@/components/charts/chart-percentages'
import { formatCurrencyBRL, formatCurrencyCompactBRL } from '../financeiro-format'

export interface CartaoMesData {
  ano: number
  mes: number
  label: string
  total: number
  qtd: number
}

interface CartaoMonthlyChartProps {
  data: CartaoMesData[]
}

export function CartaoMonthlyChart({ data }: CartaoMonthlyChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gastos por Mês</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = data.map((row, index) => {
    const previousTotal = index > 0 ? data[index - 1]?.total ?? 0 : 0
    return {
      ...row,
      deltaPct: index === 0 ? null : calculatePercentChange(previousTotal, row.total),
    }
  })
  const latestDelta = chartData[chartData.length - 1]?.deltaPct ?? null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Gastos por Mês</CardTitle>
        <p className="text-xs text-muted-foreground">
          Última variação: {formatTrendDescription(latestDelta)} vs mês anterior
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 28, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} />
              <YAxis tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as CartaoMesData & { deltaPct: number | null }

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>
                        Total:{' '}
                        <span className="font-semibold text-violet-400">
                          {formatCurrencyBRL(row.total)}
                        </span>
                      </p>
                      <p className="text-muted-foreground">{row.qtd} transações</p>
                      <p className="mt-1 border-t pt-1 text-muted-foreground">
                        Variação vs mês anterior: {formatSignedPercentChange(row.deltaPct)}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="total" name="Total" fill="#a78bfa" radius={[6, 6, 0, 0]}>
                <LabelList content={(props) => <ChartPercentChangeBarLabel {...props} />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
