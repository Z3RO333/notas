'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="nome" width={80} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Atendidas" stackId="a" fill="#16a34a" radius={[0, 0, 0, 0]}>
              {showLabels && (
                <LabelList
                  dataKey="Atendidas"
                  position="center"
                  style={{ fontSize: 10, fill: 'white', fontWeight: 600 }}
                  formatter={(v: number) => v > 0 ? v.toLocaleString('pt-BR') : ''}
                />
              )}
            </Bar>
            <Bar dataKey="Em Aberto" stackId="a" fill="#f59e0b" radius={[0, 4, 4, 0]}>
              {showLabels && (
                <LabelList
                  dataKey="Em Aberto"
                  position="right"
                  style={{ fontSize: 10 }}
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
