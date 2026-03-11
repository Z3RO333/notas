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
import { createWrappedCategoryTickRenderer } from '@/components/charts/wrapped-category-tick'
import type { GestaoTopServico } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

const WRAPPED_SERVICE_TICK = createWrappedCategoryTickRenderer({
  fill: CHART_CATEGORY_TICK.fill,
  fontSize: CHART_CATEGORY_TICK.fontSize,
  fontWeight: 500,
  maxCharsPerLine: 18,
  maxLines: 3,
  dx: -8,
})

interface TopServicosChartProps {
  data: GestaoTopServico[]
}

export function TopServicosChart({ data }: TopServicosChartProps) {
  const { showLabels } = useChartLabels()

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Servicos Solicitados</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = data.map((item) => ({
    ...item,
    label: item.texto_breve,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Servicos Solicitados</CardTitle>
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
                width={188}
                tick={WRAPPED_SERVICE_TICK}
                interval={0}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload

                  return (
                    <div className="max-w-[260px] rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 break-words font-medium">{row.texto_breve ?? label}</p>
                      <p>
                        Notas:{' '}
                        <span className="font-semibold text-green-600">
                          {row.total_notas.toLocaleString('pt-BR')}
                        </span>
                      </p>
                      <p className="text-muted-foreground">{row.percentual}% do total</p>
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
                    formatter={(value: number) => value.toLocaleString('pt-BR')}
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
