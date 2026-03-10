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
import {
  CHART_AXIS_TICK,
  CHART_CATEGORY_TICK,
  CHART_GRID_STROKE,
  CHART_VALUE_LABEL,
} from '@/components/charts/chart-theme'
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
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={CHART_AXIS_TICK} />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tick={CHART_CATEGORY_TICK}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const item = chartData.find((d) => d.label === label)
                  const d = payload[0].payload
                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md max-w-[260px]">
                      <p className="font-medium mb-1 break-words">{item?.texto_breve ?? label}</p>
                      <p>Notas: <span className="font-semibold text-green-600">{d.total_notas.toLocaleString('pt-BR')}</span></p>
                      <p className="text-muted-foreground">{d.percentual}% do total</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="total_notas" name="total_notas" fill="#16a34a" radius={[0, 4, 4, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="total_notas"
                    position="right"
                    style={CHART_VALUE_LABEL}
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
