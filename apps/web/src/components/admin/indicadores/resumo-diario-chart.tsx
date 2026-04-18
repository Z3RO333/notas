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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
      <Card className="border-border/60 bg-background/75">
        <CardHeader>
          <CardTitle className="text-base">Resumo diário</CardTitle>
          <CardDescription>
            Entradas, conversões e conclusões distribuídas por dia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no período selecionado.</p>
        </CardContent>
      </Card>
    )
  }

  const data = rows.map((row) => ({
    ...row,
    label: row.data_ref.slice(8, 10),
  }))

  const totalEntradas = rows.reduce((sum, row) => sum + row.notas_entradas, 0)
  const totalConversoes = rows.reduce((sum, row) => sum + row.viraram_ordem, 0)
  const totalConcluidas = rows.reduce((sum, row) => sum + row.ordens_concluidas, 0)
  const maiorMovimento = rows.reduce((currentMax, row) => {
    const currentTotal = row.notas_entradas + row.viraram_ordem + row.ordens_concluidas
    const maxTotal = currentMax.notas_entradas + currentMax.viraram_ordem + currentMax.ordens_concluidas
    return currentTotal > maxTotal ? row : currentMax
  }, rows[0])

  return (
    <Card className="border-border/60 bg-background/75">
      <CardHeader className="gap-4 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Resumo diário</CardTitle>
          <CardDescription>
            Entradas, conversões e conclusões para localizar concentração de volume ao longo do período.
          </CardDescription>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Entradas: {totalEntradas.toLocaleString('pt-BR')}
          </span>
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Viraram ordem: {totalConversoes.toLocaleString('pt-BR')}
          </span>
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Concluídas: {totalConcluidas.toLocaleString('pt-BR')}
          </span>
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Maior movimento: dia {maiorMovimento.data_ref.slice(8, 10)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              barSize={8}
              barGap={4}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
              <XAxis dataKey="label" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
                labelFormatter={(label) => `Dia ${label}`}
              />
              <Legend wrapperStyle={CHART_LEGEND_STYLE} />
              <Bar dataKey="notas_entradas" name="Notas entradas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="viraram_ordem" name="Viraram ordem" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ordens_concluidas" name="Ordens concluídas" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
