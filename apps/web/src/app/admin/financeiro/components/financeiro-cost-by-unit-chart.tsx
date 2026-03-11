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
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
} from '@/components/charts/chart-theme'
import { createWrappedCategoryTickRenderer } from '@/components/charts/wrapped-category-tick'
import type { FinanceiroRankingRow } from '@/lib/types/database'
import { formatCurrencyBRL, formatCurrencyCompactBRL } from '../financeiro-format'

interface FinanceiroCostByUnitChartProps {
  data: FinanceiroRankingRow[]
}

const wrappedTick = createWrappedCategoryTickRenderer({
  fill: 'hsl(var(--foreground))',
  fontSize: 11,
  fontWeight: 500,
  maxCharsPerLine: 18,
  maxLines: 2,
})

export function FinanceiroCostByUnitChart({ data }: FinanceiroCostByUnitChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custo por Unidade</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartHeight = Math.max(340, data.length * 52)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custo por Unidade</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[340px] xl:h-[420px]" style={{ minHeight: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 4, left: 24 }}
            >
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <YAxis
                type="category"
                dataKey="nome"
                width={170}
                tick={wrappedTick}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as FinanceiroRankingRow

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{row.nome}</p>
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
              <Bar dataKey="realizado" name="Realizado" stackId="financeiro" fill="#22c55e" radius={[0, 4, 4, 0]} />
              <Bar dataKey="previsto_pendente" name="Previsto pendente" stackId="financeiro" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
