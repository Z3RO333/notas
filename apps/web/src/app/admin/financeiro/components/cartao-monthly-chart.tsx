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
  CHART_AXIS_TICK_MD,
  CHART_GRID_STROKE,
} from '@/components/charts/chart-theme'
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gastos por Mes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK_MD} />
              <YAxis tick={CHART_AXIS_TICK} tickFormatter={formatCurrencyCompactBRL} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as CartaoMesData

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
                    </div>
                  )
                }}
              />
              <Bar dataKey="total" name="Total" fill="#a78bfa" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
