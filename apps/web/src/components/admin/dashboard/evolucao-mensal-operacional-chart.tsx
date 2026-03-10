'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
          <CardTitle className="text-base">Evolução Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no período.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Evolução Mensal
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: showLabels ? 20 : 4, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} minTickGap={20} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} />
            <Tooltip
              formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="concluidas"
              name="Concluídas"
              stroke="#16a34a"
              strokeWidth={2}
              dot={{ r: showLabels ? 3 : 3 }}
            >
              {showLabels && (
                <LabelList
                  dataKey="concluidas"
                  position="top"
                  style={{ fontSize: 10, fill: '#e5e7eb' }}
                  formatter={(v: number) => v.toLocaleString('pt-BR')}
                />
              )}
            </Line>
            <Line
              type="monotone"
              dataKey="em_aberto"
              name="Em Aberto"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 3 }}
              strokeDasharray="4 2"
            >
              {showLabels && (
                <LabelList
                  dataKey="em_aberto"
                  position="top"
                  style={{ fontSize: 10, fill: '#e5e7eb' }}
                  formatter={(v: number) => v.toLocaleString('pt-BR')}
                />
              )}
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
