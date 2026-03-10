'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
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
  CHART_LEGEND_STYLE,
  CHART_VALUE_LABEL,
} from '@/components/charts/chart-theme'
import type { GestaoTopLoja, TipoUnidade } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

const TIPO_TITULO: Record<TipoUnidade, string> = {
  LOJA: 'Top Lojas – Ordens Geradas',
  FARMA: 'Top Farmas – Ordens Geradas',
  CD: 'Top CDs – Ordens Geradas',
}

interface TopLojasChartProps {
  data: GestaoTopLoja[]
  tipoUnidade?: TipoUnidade
}

export function TopLojasChart({ data, tipoUnidade }: TopLojasChartProps) {
  const { showLabels } = useChartLabels()
  const titulo = tipoUnidade ? TIPO_TITULO[tipoUnidade] : 'Top Unidades – Ordens Geradas'

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{titulo}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = [...data].reverse().map((row) => ({
    ...row,
    outros: Math.max(0, row.total_ordens - row.concluidas - row.em_aberto),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 4, right: showLabels ? 56 : 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={CHART_AXIS_TICK} />
              <YAxis
                type="category"
                dataKey="nome_loja"
                width={130}
                tick={CHART_CATEGORY_TICK}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  value.toLocaleString('pt-BR'),
                  name,
                ]}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar dataKey="concluidas" name="Concluídas" stackId="a" fill="#16a34a" />
              <Bar dataKey="em_aberto" name="Em Aberto" stackId="a" fill="#f59e0b" />
              <Bar dataKey="outros" name="Outros" stackId="a" fill="#6b7280" radius={[0, 4, 4, 0]}>
                {showLabels && (
                  <LabelList
                    dataKey="total_ordens"
                    position="right"
                    style={CHART_VALUE_LABEL}
                    formatter={(v: number) => (v > 0 ? v.toLocaleString('pt-BR') : '')}
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
