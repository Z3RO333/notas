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
import { useChartLabels } from '@/components/charts/chart-labels-context'
import { formatCurrencyBRL, formatCurrencyCompactBRL } from '@/app/admin/financeiro/financeiro-format'
import type { FinanceMetricKey, SupplierMonthlyComparisonRow } from '../comparativos-utils'

interface SupplierMonthlyChartProps {
  rows: SupplierMonthlyComparisonRow[]
  anoBase: number
  anoComparado: number
  fornecedorNome: string
}

const METRIC_OPTIONS: Array<{ key: FinanceMetricKey; label: string }> = [
  { key: 'total_gasto', label: 'Total' },
  { key: 'valor_realizado', label: 'Realizado' },
  { key: 'valor_previsto_pendente', label: 'Pendente' },
]

export function SupplierMonthlyChart({
  rows,
  anoBase,
  anoComparado,
  fornecedorNome,
}: SupplierMonthlyChartProps) {
  const [metric, setMetric] = useState<FinanceMetricKey>('total_gasto')
  const { showLabels } = useChartLabels()

  const data = rows
    .filter((row) => row.mes !== null)
    .map((row) => ({
      label: row.label,
      valorBase: metric === 'total_gasto'
        ? row.totalBase
        : metric === 'valor_realizado'
          ? row.realizadoBase
          : row.pendenteBase,
      valorComparado: metric === 'total_gasto'
        ? row.totalComparado
        : metric === 'valor_realizado'
          ? row.realizadoComparado
          : row.pendenteComparado,
    }))

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base">Fornecedor por mes - {fornecedorNome}</CardTitle>
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
            <ComposedChart data={data} margin={{ top: showLabels ? 20 : 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} minTickGap={20} />
              <YAxis tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <Tooltip
                formatter={(value: number) => formatCurrencyBRL(value)}
                contentStyle={{ borderRadius: 12 }}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar dataKey="valorBase" name={String(anoBase)} fill="#b45309" radius={[6, 6, 0, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="valorBase"
                    position="top"
                    style={CHART_VALUE_LABEL_SM}
                    formatter={(value: number) => formatCurrencyCompactBRL(value)}
                  />
                )}
              </Bar>
              <Bar dataKey="valorComparado" name={String(anoComparado)} fill="#0f766e" radius={[6, 6, 0, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="valorComparado"
                    position="top"
                    style={CHART_VALUE_LABEL_SM}
                    formatter={(value: number) => formatCurrencyCompactBRL(value)}
                  />
                )}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
