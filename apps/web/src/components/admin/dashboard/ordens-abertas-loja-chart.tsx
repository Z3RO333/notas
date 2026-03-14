'use client'

import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CHART_AXIS_TICK,
  CHART_CATEGORY_TICK,
  CHART_GRID_STROKE,
  CHART_VALUE_LABEL,
} from '@/components/charts/chart-theme'
import { calculateShare, formatPercent } from '@/components/charts/chart-percentages'
import type { OrdensAbertasLoja } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'
import { OperacionalUnidadeOrdensDialog } from './operacional-unidade-ordens-dialog'

interface OrdensAbertasLojaChartProps {
  rows: OrdensAbertasLoja[]
  periodLabel: string
  startIso: string
  endExclusiveIso: string
  fornecedorCodigo?: string | null
}

export function OrdensAbertasLojaChart({
  rows,
  periodLabel,
  startIso,
  endExclusiveIso,
  fornecedorCodigo,
}: OrdensAbertasLojaChartProps) {
  const { showLabels } = useChartLabels()
  const [selectedUnidade, setSelectedUnidade] = useState<string | null>(null)

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
  const totalAbertas = data.reduce((sum, row) => sum + row.total_abertas, 0)
  const leadShare = calculateShare(rows[0]?.total_abertas ?? 0, totalAbertas)

  return (
    <>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">
            Em Aberto por Loja
            <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Lider concentra {formatPercent(leadShare)} das ordens abertas
          </p>
          <p className="text-xs text-muted-foreground">Clique em uma loja para ver as ordens e o que esta pendente.</p>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 4, right: showLabels ? 36 : 24, bottom: 4, left: 8 }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={CHART_AXIS_TICK} />
              <YAxis type="category" dataKey="unidade" width={130} tick={CHART_CATEGORY_TICK} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as OrdensAbertasLoja

                  return (
                    <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      <p>Em Aberto: <span className="font-semibold text-red-500">{row.total_abertas.toLocaleString('pt-BR')}</span></p>
                      <p className="text-muted-foreground">
                        Participacao no periodo: {formatPercent(calculateShare(row.total_abertas, totalAbertas))}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="total_abertas"
                radius={[0, 4, 4, 0]}
                onClick={(entry: OrdensAbertasLoja) => setSelectedUnidade(entry.unidade)}
              >
                {data.map((entry, index) => {
                  const intensity = entry.total_abertas / max
                  const opacity = 0.4 + intensity * 0.6
                  return <Cell key={index} fill={`rgba(239, 68, 68, ${opacity})`} />
                })}
                {showLabels && (
                  <LabelList
                    dataKey="total_abertas"
                    position="right"
                    style={CHART_VALUE_LABEL}
                    formatter={(v: number) => v.toLocaleString('pt-BR')}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {selectedUnidade && (
        <OperacionalUnidadeOrdensDialog
          unidade={selectedUnidade}
          startIso={startIso}
          endExclusiveIso={endExclusiveIso}
          periodLabel={periodLabel}
          fornecedorCodigo={fornecedorCodigo}
          open={!!selectedUnidade}
          onClose={() => setSelectedUnidade(null)}
        />
      )}
    </>
  )
}
