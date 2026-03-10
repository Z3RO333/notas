'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CHART_AXIS_TICK,
  CHART_CATEGORY_TICK,
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
  CHART_VALUE_LABEL_SM,
} from '@/components/charts/chart-theme'
import type { ProdutividadeOperacional } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface StatusBarChartProps {
  rows: ProdutividadeOperacional[]
  periodLabel: string
}

export function StatusBarChart({ rows, periodLabel }: StatusBarChartProps) {
  const { showLabels } = useChartLabels()

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status por Operacional</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no período.</p>
        </CardContent>
      </Card>
    )
  }

  const data = rows.map((r) => ({
    nome: r.fornecedor_nome
      ? r.fornecedor_nome.split(' ')[0]
      : r.fornecedor_codigo,
    Atendidas: r.atendidas,
    'Em Aberto': r.em_aberto,
    Outros: Math.max(0, r.total_ordens - r.atendidas - r.em_aberto),
    total_ordens: r.total_ordens,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Status por Operacional
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: showLabels ? 52 : 24, bottom: 4, left: 8 }}
          >
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={CHART_AXIS_TICK} />
            <YAxis type="category" dataKey="nome" width={80} tick={CHART_CATEGORY_TICK} />
            <Tooltip
              formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            <Bar dataKey="Atendidas" stackId="a" fill="#16a34a">
              {showLabels && (
                <LabelList
                  dataKey="Atendidas"
                  position="center"
                  style={{ fontSize: 10, fill: 'white', fontWeight: 600 }}
                  formatter={(v: number) => v > 0 ? v.toLocaleString('pt-BR') : ''}
                />
              )}
            </Bar>
            <Bar dataKey="Em Aberto" stackId="a" fill="#f59e0b" />
            <Bar dataKey="Outros" stackId="a" fill="#6b7280" radius={[0, 4, 4, 0]}>
              {showLabels && (
                <LabelList
                  dataKey="total_ordens"
                  position="right"
                  style={CHART_VALUE_LABEL_SM}
                  formatter={(v: number) => v > 0 ? v.toLocaleString('pt-BR') : ''}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
