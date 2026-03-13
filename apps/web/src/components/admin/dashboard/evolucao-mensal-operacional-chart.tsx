'use client'

import {
  Bar,
  ComposedChart,
  CartesianGrid,
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
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
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
import type { EvolucaoMensalOperacional } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface EvolucaoMensalOperacionalChartProps {
  rows: EvolucaoMensalOperacional[]
  periodLabel: string
}

export function EvolucaoMensalOperacionalChart({ rows, periodLabel }: EvolucaoMensalOperacionalChartProps) {
  const { showLabels } = useChartLabels()

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolucao Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no periodo.</p>
        </CardContent>
      </Card>
    )
  }

  const data = rows.map((row, index) => {
    const total = row.concluidas + row.em_aberto
    const previousTotal = index > 0
      ? (rows[index - 1]?.concluidas ?? 0) + (rows[index - 1]?.em_aberto ?? 0)
      : 0

    return {
      ...row,
      total,
      deltaPct: index === 0 ? null : calculatePercentChange(previousTotal, total),
    }
  })
  const latestDelta = data[data.length - 1]?.deltaPct ?? null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          Evolucao Mensal
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ultima variacao do total: {formatTrendDescription(latestDelta)} vs mes anterior
        </p>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: showLabels ? 34 : 22, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={CHART_AXIS_TICK} minTickGap={20} />
            <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0].payload as EvolucaoMensalOperacional & {
                  total: number
                  deltaPct: number | null
                }

                return (
                  <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium">{label}</p>
                    <p>Concluidas: <span className="font-semibold text-green-600">{row.concluidas.toLocaleString('pt-BR')}</span></p>
                    <p>Em Aberto: <span className="font-semibold text-amber-500">{row.em_aberto.toLocaleString('pt-BR')}</span></p>
                    <p>Total: <span className="font-semibold">{row.total.toLocaleString('pt-BR')}</span></p>
                    <p className="mt-1 border-t pt-1 text-muted-foreground">
                      Variacao vs mes anterior: {formatSignedPercentChange(row.deltaPct)}
                    </p>
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            <Bar
              dataKey="concluidas"
              name="Concluidas"
              fill="#16a34a"
              radius={[6, 6, 0, 0]}
            >
              {showLabels && (
                <LabelList
                  dataKey="concluidas"
                  position="top"
                  style={CHART_VALUE_LABEL_SM}
                  formatter={(value: number) => value.toLocaleString('pt-BR')}
                />
              )}
            </Bar>
            <Bar
              dataKey="em_aberto"
              name="Em Aberto"
              fill="#f59e0b"
              radius={[6, 6, 0, 0]}
            >
              {showLabels && (
                <LabelList
                  dataKey="em_aberto"
                  position="top"
                  style={CHART_VALUE_LABEL_SM}
                  formatter={(value: number) => value.toLocaleString('pt-BR')}
                />
              )}
            </Bar>
            <Line
              type="monotone"
              dataKey="total"
              name="Total"
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
      </CardContent>
    </Card>
  )
}
