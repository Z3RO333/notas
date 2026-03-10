'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GestaoTopServico } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface TopServicosChartProps {
  data: GestaoTopServico[]
}

export function TopServicosChart({ data }: TopServicosChartProps) {
  const { showLabels } = useChartLabels()

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Serviços Solicitados</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = data.map((d) => ({
    ...d,
    // Truncar labels longos para caber no gráfico
    label: d.texto_breve.length > 22 ? `${d.texto_breve.slice(0, 22)}…` : d.texto_breve,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Serviços Solicitados</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={[...chartData].reverse()}
              margin={{ top: 4, right: showLabels ? 52 : 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'total_notas') return [value.toLocaleString('pt-BR'), 'Notas']
                  return [value, name]
                }}
                labelFormatter={(label: string) => {
                  const item = chartData.find((d) => d.label === label)
                  return item?.texto_breve ?? label
                }}
              />
              <Bar dataKey="total_notas" name="total_notas" fill="#16a34a" radius={[0, 4, 4, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="total_notas"
                    position="right"
                    style={{ fontSize: 11, fill: '#e5e7eb' }}
                    formatter={(v: number) => v.toLocaleString('pt-BR')}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
