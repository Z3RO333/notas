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
import type { GestaoTopLoja, TipoUnidade } from '@/lib/types/database'

const TIPO_TITULO: Record<TipoUnidade, string> = {
  LOJA: 'Top Lojas – Ordens Geradas',
  FARMA: 'Top Farmas – Ordens Geradas',
  CD: 'Top CDs – Ordens Geradas',
}

const TIPO_COR: Record<TipoUnidade, string> = {
  LOJA: '#2563eb',
  FARMA: '#16a34a',
  CD: '#d97706',
}

interface TopLojasChartProps {
  data: GestaoTopLoja[]
  tipoUnidade?: TipoUnidade
}

export function TopLojasChart({ data, tipoUnidade }: TopLojasChartProps) {
  const titulo = tipoUnidade ? TIPO_TITULO[tipoUnidade] : 'Top Unidades – Ordens Geradas'
  const cor = tipoUnidade ? TIPO_COR[tipoUnidade] : '#2563eb'

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{titulo}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = [...data].reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
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
                width={130}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Ordens']}
              />
              <Bar dataKey="total_ordens" name="Ordens" fill={cor} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
