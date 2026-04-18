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
  createAdaptiveBarLabelRenderer,
  getPositiveDomainMax,
} from '@/components/charts/stacked-bar-label'
import { calculateShare, formatPercent } from '@/components/charts/chart-percentages'
import type { ProdutividadeOperacional } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

const INSIDE_LIGHT_LABEL = createAdaptiveBarLabelRenderer({
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

const INSIDE_MUTED_LABEL = createAdaptiveBarLabelRenderer({
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
          <p className="text-sm text-muted-foreground">Nenhum dado no período.</p>
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
  const totalPeriodo = data.reduce((sum, row) => sum + row.total_exibido, 0)
  const axisMax = getPositiveDomainMax(data.map((row) => row.total_exibido), 0.12, 14)
  const topShare = calculateShare(data[0]?.total_exibido ?? 0, totalPeriodo)

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          Status por Operacional
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Maior participação no período: {formatPercent(topShare)}
        </p>
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
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0].payload as {
                  nome: string
                  Atendidas: number
                  'Em Aberto': number
                  Outros: number
                  total_exibido: number
                }

                return (
                  <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium">{label}</p>
                    <p>Concluídas: <span className="font-semibold" style={{ color: '#1E90FF' }}>{row.Atendidas.toLocaleString('pt-BR')}</span> <span className="text-muted-foreground">({formatPercent(calculateShare(row.Atendidas, row.total_exibido))})</span></p>
                    <p>Pendentes: <span className="font-semibold" style={{ color: '#B22222' }}>{row['Em Aberto'].toLocaleString('pt-BR')}</span> <span className="text-muted-foreground">({formatPercent(calculateShare(row['Em Aberto'], row.total_exibido))})</span></p>
                    <p>Outros: <span className="font-semibold text-slate-500">{row.Outros.toLocaleString('pt-BR')}</span> <span className="text-muted-foreground">({formatPercent(calculateShare(row.Outros, row.total_exibido))})</span></p>
                    <p className="mt-1 border-t pt-1">Total: <span className="font-semibold">{row.total_exibido.toLocaleString('pt-BR')}</span></p>
                    <p className="text-muted-foreground">
                      Participação no período: {formatPercent(calculateShare(row.total_exibido, totalPeriodo))}
                    </p>
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            <Bar dataKey="Atendidas" name="Concluídas" stackId="a" fill="#1E90FF">
              {showLabels && (
                <LabelList
                  dataKey="Atendidas"
                  content={INSIDE_LIGHT_LABEL}
                />
              )}
            </Bar>
            <Bar dataKey="Em Aberto" name="Pendentes" stackId="a" fill="#B22222">
              {showLabels && (
                <LabelList
                  dataKey="Em Aberto"
                  content={INSIDE_LIGHT_LABEL}
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
