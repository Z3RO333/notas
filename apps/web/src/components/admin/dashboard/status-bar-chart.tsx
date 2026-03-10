'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CHART_AXIS_TICK,
  CHART_CATEGORY_TICK,
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
} from '@/components/charts/chart-theme'
import type { ProdutividadeOperacional } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

const INSIDE_LIGHT_LABEL = { fontSize: 10, fill: '#ffffff', fontWeight: 600 } as const
const INSIDE_DARK_LABEL = { fontSize: 10, fill: '#111827', fontWeight: 700 } as const

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
          <p className="text-sm text-muted-foreground">Nenhum dado no periodo.</p>
        </CardContent>
      </Card>
    )
  }

  const data = rows.map((row) => ({
    nome: row.fornecedor_nome ? row.fornecedor_nome.split(' ')[0] : row.fornecedor_codigo,
    Atendidas: row.atendidas,
    'Em Aberto': row.em_aberto,
    Outros: Math.max(0, row.total_ordens - row.atendidas - row.em_aberto),
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
            margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
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
                  style={INSIDE_LIGHT_LABEL}
                  formatter={(v: number) => (v > 0 ? v.toLocaleString('pt-BR') : '')}
                />
              )}
            </Bar>
            <Bar dataKey="Em Aberto" stackId="a" fill="#f59e0b">
              {showLabels && (
                <LabelList
                  dataKey="Em Aberto"
                  position="center"
                  style={INSIDE_DARK_LABEL}
                  formatter={(v: number) => (v > 0 ? v.toLocaleString('pt-BR') : '')}
                />
              )}
            </Bar>
            <Bar dataKey="Outros" stackId="a" fill="#6b7280" radius={[0, 4, 4, 0]}>
              {showLabels && (
                <LabelList
                  dataKey="Outros"
                  position="center"
                  style={INSIDE_LIGHT_LABEL}
                  formatter={(v: number) => (v > 0 ? v.toLocaleString('pt-BR') : '')}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
