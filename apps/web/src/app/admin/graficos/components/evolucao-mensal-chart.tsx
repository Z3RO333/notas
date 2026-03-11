'use client'

import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CHART_AXIS_TICK,
  CHART_AXIS_TICK_MD,
  CHART_GRID_STROKE,
  CHART_VALUE_LABEL_SM,
} from '@/components/charts/chart-theme'
import type { GestaoEvolucaoMes } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'

interface EvolucaoMensalChartProps {
  data: GestaoEvolucaoMes[]
}

export function EvolucaoMensalChart({ data }: EvolucaoMensalChartProps) {
  const { showLabels } = useChartLabels()

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolucao Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evolucao Mensal - Ordens</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: showLabels ? 20 : 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={20} tick={CHART_AXIS_TICK_MD} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>
                        Ordens:{' '}
                        <span className="font-semibold text-blue-600">
                          {row.total_ordens.toLocaleString('pt-BR')}
                        </span>
                      </p>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="total_ordens"
                name="total_ordens"
                stroke="#2563eb"
                strokeWidth={2}
                dot={showLabels}
              >
                {showLabels && (
                  <LabelList
                    dataKey="total_ordens"
                    position="top"
                    style={CHART_VALUE_LABEL_SM}
                    formatter={(value: number) => value.toLocaleString('pt-BR')}
                  />
                )}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
