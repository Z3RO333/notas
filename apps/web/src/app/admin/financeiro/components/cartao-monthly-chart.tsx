'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
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
  CHART_PERCENT_LINE_STROKE,
} from '@/components/charts/chart-theme'
import { ChartPercentChangeLabel } from '@/components/charts/chart-percent-change-label'
import {
  calculatePercentChange,
  formatPercentChangeLabel,
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
          <CardTitle className="text-base">Gastos por Mes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
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
      deltaPctPlot: index === 0 ? null : calculatePercentChange(previousTotal, row.total),
    }
  })
  const latestDelta = chartData[chartData.length - 1]?.deltaPct ?? null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Gastos por Mes</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ultima variacao: {formatTrendDescription(latestDelta)} vs mes anterior
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 28, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} />
              <YAxis yAxisId="valor" tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <YAxis
                yAxisId="percent"
                orientation="right"
                tick={CHART_AXIS_TICK}
                tickFormatter={(value: number) => formatPercentChangeLabel(value)}
                width={56}
              />
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
                      <p className="text-muted-foreground">{row.qtd} transacoes</p>
                      <p className="mt-1 border-t pt-1 text-muted-foreground">
                        Variacao vs mes anterior: {formatSignedPercentChange(row.deltaPct)}
                      </p>
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar yAxisId="valor" dataKey="total" name="Total" fill="#a78bfa" radius={[6, 6, 0, 0]} />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="deltaPctPlot"
                name="Variacao %"
                stroke={CHART_PERCENT_LINE_STROKE}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART_PERCENT_LINE_STROKE, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: CHART_PERCENT_LINE_STROKE, strokeWidth: 0 }}
                connectNulls={false}
              >
                <LabelList content={(props) => <ChartPercentChangeLabel {...props} />} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
