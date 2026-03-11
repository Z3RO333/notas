'use client'

import {
  Bar,
  CartesianGrid,
  Cell,
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
import type { GestaoEvolucaoMes } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface EvolucaoMensalChartProps {
  data: GestaoEvolucaoMes[]
}

const MONTH_BAR_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
]

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evolucao Mensal - Ordens</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: showLabels ? 20 : 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" minTickGap={20} tick={CHART_AXIS_TICK_MD} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>
                        Ordens:{' '}
                        <span className="font-semibold text-blue-600">
                          {row.total_ordens.toLocaleString('pt-BR')}
                        </span>
                      </p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="total_ordens"
                name="total_ordens"
                radius={[6, 6, 0, 0]}
              >
                {data.map((row, index) => (
                  <Cell
                    key={`${row.label}-${index}`}
                    fill={MONTH_BAR_COLORS[index % MONTH_BAR_COLORS.length]}
                  />
                ))}
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
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
