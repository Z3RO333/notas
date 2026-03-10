'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProdutividadeLoja } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface ProdutividadeLojaChartProps {
  rows: ProdutividadeLoja[]
  periodLabel: string
}

function getBarColor(pct: number): string {
  if (pct >= 80) return '#16a34a'
  if (pct >= 50) return '#f59e0b'
  return '#ef4444'
}

export function ProdutividadeLojaChart({ rows, periodLabel }: ProdutividadeLojaChartProps) {
  const { showLabels } = useChartLabels()

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtividade por Loja</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no período.</p>
        </CardContent>
      </Card>
    )
  }

  const data = [...rows]
    .sort((a, b) => a.pct_conclusao - b.pct_conclusao)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Produtividade por Loja
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({periodLabel}) — % conclusão
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: showLabels ? 60 : 40, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
            />
            <YAxis type="category" dataKey="unidade" width={130} tick={{ fontSize: 11, fill: '#d1d5db' }} />
            <Tooltip
              formatter={(value: number, _name: string, props) => {
                const { atendidas, em_aberto, total_ordens } = props.payload as ProdutividadeLoja
                return [
                  `${value.toFixed(1)}% (${atendidas} de ${total_ordens} · ${em_aberto} em aberto)`,
                  '% Conclusão',
                ]
              }}
            />
            <Bar dataKey="pct_conclusao" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => (
                <Cell key={index} fill={getBarColor(entry.pct_conclusao)} />
              ))}
              {showLabels && (
                <LabelList
                  dataKey="pct_conclusao"
                  position="right"
                  style={{ fontSize: 11, fill: '#e5e7eb' }}
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
