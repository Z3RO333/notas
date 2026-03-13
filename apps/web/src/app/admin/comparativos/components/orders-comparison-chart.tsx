'use client'

import { useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  CHART_AXIS_TICK,
  CHART_AXIS_TICK_MD,
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
  CHART_VALUE_LABEL_SM,
} from '@/components/charts/chart-theme'
import { ChartPercentChangeBarLabel } from '@/components/charts/chart-percent-change-label'
import {
  calculatePercentChange,
  formatSignedPercentChange,
} from '@/components/charts/chart-percentages'
import { useChartLabels } from '@/components/charts/chart-labels-context'
import type { ComparativoOrdensMes } from '@/lib/types/database'
import { buildOrdersChartRows, type OrdersMetricKey } from '../comparativos-utils'

interface OrdersComparisonChartProps {
  rows: ComparativoOrdensMes[]
  anoBase: number
  anoComparado: number
}

const METRIC_OPTIONS: Array<{ key: OrdersMetricKey; label: string }> = [
  { key: 'total_ordens', label: 'Total' },
  { key: 'ordens_abertas', label: 'Abertas' },
  { key: 'ordens_executadas', label: 'Executadas' },
]

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function OrdersComparisonChart({
  rows,
  anoBase,
  anoComparado,
}: OrdersComparisonChartProps) {
  const [metric, setMetric] = useState<OrdersMetricKey>('total_ordens')
  const { showLabels } = useChartLabels()
  const data = buildOrdersChartRows(rows, anoBase, anoComparado, metric).map((row) => ({
    ...row,
    deltaAbs: row.valorComparado - row.valorBase,
    deltaPct: calculatePercentChange(row.valorBase, row.valorComparado),
  }))
  const totalBase = data.reduce((sum, row) => sum + row.valorBase, 0)
  const totalComparado = data.reduce((sum, row) => sum + row.valorComparado, 0)
  const totalDeltaPct = calculatePercentChange(totalBase, totalComparado)

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Ordens por mes</CardTitle>
            <p className="text-xs text-muted-foreground">
              Variacao acumulada do periodo: {formatSignedPercentChange(totalDeltaPct)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {METRIC_OPTIONS.map((option) => (
              <Button
                key={option.key}
                type="button"
                size="sm"
                variant={metric === option.key ? 'default' : 'outline'}
                onClick={() => setMetric(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: showLabels ? 36 : 28, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} minTickGap={20} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as {
                    label: string
                    valorBase: number
                    valorComparado: number
                    deltaAbs: number
                    deltaPct: number | null
                  }

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>{anoBase}: <span className="font-semibold text-slate-500">{formatInteger(row.valorBase)}</span></p>
                      <p>{anoComparado}: <span className="font-semibold text-blue-600">{formatInteger(row.valorComparado)}</span></p>
                      <p>Delta: <span className="font-semibold">{formatInteger(row.deltaAbs)}</span></p>
                      <p className="mt-1 border-t pt-1 text-muted-foreground">
                        Variacao: {formatSignedPercentChange(row.deltaPct)}
                      </p>
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar dataKey="valorBase" name={String(anoBase)} fill="#94a3b8" radius={[6, 6, 0, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="valorBase"
                    position="top"
                    style={CHART_VALUE_LABEL_SM}
                    formatter={(value: number) => formatInteger(value)}
                  />
                )}
              </Bar>
              <Bar dataKey="valorComparado" name={String(anoComparado)} fill="#2563eb" radius={[6, 6, 0, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="valorComparado"
                    position="top"
                    style={CHART_VALUE_LABEL_SM}
                    formatter={(value: number) => formatInteger(value)}
                  />
                )}
                <LabelList
                  content={(props) => (
                    <ChartPercentChangeBarLabel {...props} showValueLabels={showLabels} />
                  )}
                />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
