'use client'

import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
          <CardTitle className="text-base">Evolução Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evolução Mensal – Ordens e Notas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: showLabels ? 20 : 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={20} tick={{ fontSize: 12, fill: '#9ca3af' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    total_ordens: 'Ordens',
                    total_notas: 'Notas',
                  }
                  return [value.toLocaleString('pt-BR'), labels[name] ?? name]
                }}
              />
              <Legend
                formatter={(value: string) => {
                  const labels: Record<string, string> = {
                    total_ordens: 'Ordens',
                    total_notas: 'Notas',
                  }
                  return labels[value] ?? value
                }}
              />
              <Line
                type="monotone"
                dataKey="total_ordens"
                name="total_ordens"
                stroke="#2563eb"
                strokeWidth={2}
                dot={showLabels}
              >
                {showLabels && (
                  <LabelList
                    dataKey="total_ordens"
                    position="top"
                    style={{ fontSize: 10, fill: '#e5e7eb' }}
                    formatter={(v: number) => v.toLocaleString('pt-BR')}
                  />
                )}
              </Line>
              <Line
                type="monotone"
                dataKey="total_notas"
                name="total_notas"
                stroke="#16a34a"
                strokeWidth={2}
                dot={showLabels}
              >
                {showLabels && (
                  <LabelList
                    dataKey="total_notas"
                    position="top"
                    style={{ fontSize: 10, fill: '#e5e7eb' }}
                    formatter={(v: number) => v.toLocaleString('pt-BR')}
                  />
                )}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
