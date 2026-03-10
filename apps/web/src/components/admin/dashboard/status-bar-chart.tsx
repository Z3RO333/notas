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
import {
  createInsideBarLabelRenderer,
  getPositiveDomainMax,
} from '@/components/charts/stacked-bar-label'
import type { ProdutividadeOperacional } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

const INSIDE_LIGHT_LABEL = createInsideBarLabelRenderer({
  fill: '#ffffff',
  fontSize: 10,
  fontWeight: 600,
  paddingX: 7,
  fallbackPosition: 'barStart',
  fallbackOffset: 6,
  fallbackStroke: 'hsl(var(--card))',
  formatter: (value) => {
    const numericValue = Number(value)
    return numericValue > 0 ? numericValue.toLocaleString('pt-BR') : ''
  },
})

const INSIDE_DARK_LABEL = createInsideBarLabelRenderer({
  fill: '#111827',
  fontSize: 10,
  fontWeight: 700,
  paddingX: 7,
  fallbackPosition: 'barStart',
  fallbackOffset: 6,
  fallbackStroke: 'hsl(var(--card))',
  formatter: (value) => {
    const numericValue = Number(value)
    return numericValue > 0 ? numericValue.toLocaleString('pt-BR') : ''
  },
})

const INSIDE_MUTED_LABEL = createInsideBarLabelRenderer({
  fill: '#ffffff',
  fontSize: 10,
  fontWeight: 600,
  paddingX: 7,
  fallbackPosition: 'segmentEnd',
  fallbackOffset: 6,
  fallbackStroke: 'hsl(var(--card))',
  formatter: (value) => {
    const numericValue = Number(value)
    return numericValue > 0 ? numericValue.toLocaleString('pt-BR') : ''
  },
})

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
    total_exibido: row.total_ordens,
  }))
  const axisMax = getPositiveDomainMax(data.map((row) => row.total_exibido), 0.12, 14)

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
            margin={{ top: 4, right: 52, bottom: 4, left: 8 }}
          >
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={CHART_AXIS_TICK} domain={[0, axisMax]} />
            <YAxis type="category" dataKey="nome" width={92} tick={CHART_CATEGORY_TICK} />
            <Tooltip
              formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            <Bar dataKey="Atendidas" stackId="a" fill="#16a34a">
              {showLabels && (
                <LabelList
                  dataKey="Atendidas"
                  content={INSIDE_LIGHT_LABEL}
                />
              )}
            </Bar>
            <Bar dataKey="Em Aberto" stackId="a" fill="#f59e0b">
              {showLabels && (
                <LabelList
                  dataKey="Em Aberto"
                  content={INSIDE_DARK_LABEL}
                />
              )}
            </Bar>
            <Bar dataKey="Outros" stackId="a" fill="#6b7280" radius={[0, 4, 4, 0]}>
              {showLabels && (
                <LabelList
                  dataKey="Outros"
                  content={INSIDE_MUTED_LABEL}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
