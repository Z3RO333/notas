'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
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
  CHART_TREND_LINE_DASH,
  CHART_TREND_LINE_OPACITY,
  CHART_TREND_LINE_STROKE,
  CHART_VALUE_LABEL_SM,
} from '@/components/charts/chart-theme'
import { ChartPercentChangeLabel } from '@/components/charts/chart-percent-change-label'
import {
  calculatePercentChange,
  formatSignedPercentChange,
  formatTrendDescription,
} from '@/components/charts/chart-percentages'
import type { GestaoEvolucaoMes } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface EvolucaoMensalChartProps {
  data: GestaoEvolucaoMes[]
}

export function EvolucaoMensalChart({ data }: EvolucaoMensalChartProps) {
  const { showLabels } = useChartLabels()

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolucao Mensal</CardTitle>
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
    const previousTotal = index > 0 ? data[index - 1]?.total_ordens ?? 0 : 0
    return {
      ...row,
      deltaPct: index === 0 ? null : calculatePercentChange(previousTotal, row.total_ordens),
    }
  })
  const latestDelta = chartData[chartData.length - 1]?.deltaPct ?? null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Evolucao Mensal - Ordens</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ultima variacao: {formatTrendDescription(latestDelta)} vs mes anterior
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: showLabels ? 34 : 26, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" minTickGap={20} tick={CHART_AXIS_TICK_MD} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as GestaoEvolucaoMes & { deltaPct: number | null }

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>
                        Ordens:{' '}
                        <span className="font-semibold text-blue-600">
                          {row.total_ordens.toLocaleString('pt-BR')}
                        </span>
                      </p>
                      <p className="mt-1 border-t pt-1 text-muted-foreground">
                        Variacao vs mes anterior: {formatSignedPercentChange(row.deltaPct)}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="total_ordens"
                name="total_ordens"
                fill="#3b82f6"
                radius={[6, 6, 0, 0]}
              >
                {showLabels && (
                  <LabelList
                    dataKey="total_ordens"
                    position="top"
                    style={CHART_VALUE_LABEL_SM}
                    formatter={(value: number) => value.toLocaleString('pt-BR')}
                  />
                )}
              </Bar>
              <Line
                type="monotone"
                dataKey="total_ordens"
                name="Tendencia"
                stroke={CHART_TREND_LINE_STROKE}
                strokeWidth={2}
                strokeDasharray={CHART_TREND_LINE_DASH}
                strokeOpacity={CHART_TREND_LINE_OPACITY}
                dot={false}
                activeDot={{ r: 4, fill: CHART_TREND_LINE_STROKE, strokeWidth: 0 }}
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
