'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GestaoTopLoja } from '@/lib/types/database'

interface TopLojasChartProps {
  data: GestaoTopLoja[]
}

export function TopLojasChart({ data }: TopLojasChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Lojas – Ordens Geradas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Recharts BarChart horizontal: layout="vertical"
  // Ordenar do maior para o menor (de cima para baixo na leitura)
  const chartData = [...data].reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Lojas – Ordens Geradas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="nome_loja"
                width={120}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Ordens']}
              />
              <Bar dataKey="total_ordens" name="Ordens" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
