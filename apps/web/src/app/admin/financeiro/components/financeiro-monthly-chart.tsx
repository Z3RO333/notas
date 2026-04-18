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
  CHART_TREND_LINE_DASH,
  CHART_TREND_LINE_OPACITY,
  CHART_TREND_LINE_STROKE,
} from '@/components/charts/chart-theme'
import { ChartPercentChangeLabel } from '@/components/charts/chart-percent-change-label'
import {
  calculatePercentChange,
  calculateShare,
  formatPercent,
  formatSignedPercentChange,
  formatTrendDescription,
} from '@/components/charts/chart-percentages'
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
          <CardTitle className="text-base">Variação Mensal de Custo</CardTitle>
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
    const previousCompromisso = index > 0 ? data[index - 1]?.compromisso_total ?? 0 : 0
    return {
      ...row,
      deltaPct: index === 0 ? null : calculatePercentChange(previousCompromisso, row.compromisso_total),
      realizadoPct: calculateShare(row.realizado, row.compromisso_total),
      pendentePct: calculateShare(row.previsto_pendente, row.compromisso_total),
    }
  })
  const latestDelta = chartData[chartData.length - 1]?.deltaPct ?? null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Variação Mensal de Custo</CardTitle>
        <p className="text-xs text-muted-foreground">
          Última variação do compromisso total: {formatTrendDescription(latestDelta)} vs mês anterior
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 28, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} />
              <YAxis tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as FinanceiroEvolucaoMes & {
                    deltaPct: number | null
                    realizadoPct: number
                    pendentePct: number
                  }

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>
                        Realizado:{' '}
                        <span className="font-semibold text-emerald-500">
                          {formatCurrencyBRL(row.realizado)}
                        </span>
                        <span className="text-muted-foreground"> ({formatPercent(row.realizadoPct)})</span>
                      </p>
                      <p>
                        Previsto pendente:{' '}
                        <span className="font-semibold text-amber-500">
                          {formatCurrencyBRL(row.previsto_pendente)}
                        </span>
                        <span className="text-muted-foreground"> ({formatPercent(row.pendentePct)})</span>
                      </p>
                      <p>
                        Gasto realizado:{' '}
                        <span className="font-semibold text-foreground">
                          {formatCurrencyBRL(row.total_gasto)}
                        </span>
                      </p>
                      <p>
                        Compromisso total:{' '}
                        <span className="font-semibold text-foreground">
                          {formatCurrencyBRL(row.compromisso_total)}
                        </span>
                      </p>
                      <p className="mt-1 border-t pt-1 text-muted-foreground">
                        Variação do compromisso vs mês anterior: {formatSignedPercentChange(row.deltaPct)}
                      </p>
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar dataKey="realizado" name="Realizado" fill="#22c55e" radius={[6, 6, 0, 0]} />
              <Bar dataKey="previsto_pendente" name="Previsto pendente" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              <Line
                type="monotone"
                dataKey="compromisso_total"
                name="Compromisso total"
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
