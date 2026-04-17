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
import type { ResumoDiarioRow } from '@/lib/types/indicadores'

interface ResumoDiarioChartProps {
  rows: ResumoDiarioRow[]
}

export function ResumoDiarioChart({ rows }: ResumoDiarioChartProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo Diário</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no período selecionado.</p>
        </CardContent>
      </Card>
    )
  }

  const data = rows.map((row) => ({
    ...row,
    label: row.data_ref.slice(8, 10), // DD
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resumo Diário</CardTitle>
      </CardHeader>
      <CardContent className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={6} barGap={2}>
            <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
            <XAxis dataKey="label" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
              labelFormatter={(label) => `Dia ${label}`}
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            <Bar dataKey="notas_entradas" name="Notas entradas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="viraram_ordem" name="Viraram ordem" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="ordens_concluidas" name="Ordens concluídas" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
