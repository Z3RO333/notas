'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
} from '@/components/charts/chart-theme'
import { createWrappedCategoryTickRenderer } from '@/components/charts/wrapped-category-tick'
import { formatCurrencyBRL, formatCurrencyCompactBRL } from '../financeiro-format'

export interface CartaoRankingRow {
  nome: string
  total: number
  qtd: number
}

interface CartaoRankingFornecedoresProps {
  data: CartaoRankingRow[]
}

const wrappedTick = createWrappedCategoryTickRenderer({
  fill: 'hsl(var(--foreground))',
  fontSize: 11,
  fontWeight: 500,
  maxCharsPerLine: 18,
  maxLines: 2,
})

export function CartaoRankingFornecedores({ data }: CartaoRankingFornecedoresProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Fornecedores</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartHeight = Math.max(300, data.length * 48)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Fornecedores</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 4, left: 24 }}
            >
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <YAxis type="category" dataKey="nome" width={170} tick={wrappedTick} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as CartaoRankingRow

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{row.nome}</p>
                      <p>
                        Total:{' '}
                        <span className="font-semibold text-violet-400">
                          {formatCurrencyBRL(row.total)}
                        </span>
                      </p>
                      <p className="text-muted-foreground">{row.qtd} transacoes</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="total" name="Total" fill="#a78bfa" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
