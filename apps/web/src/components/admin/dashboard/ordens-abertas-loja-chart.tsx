'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OrdensAbertasLoja } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface OrdensAbertasLojaChartProps {
  rows: OrdensAbertasLoja[]
  periodLabel: string
}

export function OrdensAbertasLojaChart({ rows, periodLabel }: OrdensAbertasLojaChartProps) {
  const { showLabels } = useChartLabels()

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Em Aberto por Loja</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhuma ordem em aberto no período.</p>
        </CardContent>
      </Card>
    )
  }

  const max = rows[0]?.total_abertas ?? 1
  const data = [...rows].reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Em Aberto por Loja
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: showLabels ? 36 : 24, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="unidade" width={130} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Em Aberto']}
            />
            <Bar dataKey="total_abertas" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => {
                const intensity = entry.total_abertas / max
                const opacity = 0.4 + intensity * 0.6
                return <Cell key={index} fill={`rgba(239, 68, 68, ${opacity})`} />
              })}
              {showLabels && (
                <LabelList
                  dataKey="total_abertas"
                  position="right"
                  style={{ fontSize: 11 }}
                  formatter={(v: number) => v.toLocaleString('pt-BR')}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
