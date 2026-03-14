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
import type { ProdutividadeLoja } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'
import { OperacionalUnidadeOrdensDialog } from './operacional-unidade-ordens-dialog'

interface ProdutividadeLojaChartProps {
  rows: ProdutividadeLoja[]
  periodLabel: string
  startIso: string
  endExclusiveIso: string
  fornecedorCodigo?: string | null
}

function getBarColor(pct: number): string {
  if (pct >= 80) return '#16a34a'
  if (pct >= 50) return '#f59e0b'
  return '#ef4444'
}

export function ProdutividadeLojaChart({
  rows,
  periodLabel,
  startIso,
  endExclusiveIso,
  fornecedorCodigo,
}: ProdutividadeLojaChartProps) {
  const { showLabels } = useChartLabels()
  const [selectedUnidade, setSelectedUnidade] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtividade por Loja</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado no periodo.</p>
        </CardContent>
      </Card>
    )
  }

  const data = [...rows].sort((a, b) => a.pct_conclusao - b.pct_conclusao)
  const totalOrdensPeriodo = data.reduce((sum, row) => sum + row.total_ordens, 0)
  const bestRate = data[data.length - 1]?.pct_conclusao ?? 0

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          Produtividade por Loja
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({periodLabel}) - % conclusao
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Melhor taxa de conclusao: {formatPercent(bestRate)}
        </p>
        <p className="text-xs text-muted-foreground">Clique em uma loja para abrir as ordens e separar pendentes de atendidas.</p>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: showLabels ? 60 : 40, bottom: 4, left: 8 }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
              tick={CHART_AXIS_TICK}
            />
            <YAxis type="category" dataKey="unidade" width={130} tick={CHART_CATEGORY_TICK} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0].payload as ProdutividadeLoja

                return (
                  <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium">{label}</p>
                    <p>% Conclusao: <span className="font-semibold">{formatPercent(row.pct_conclusao)}</span></p>
                    <p>Atendidas: <span className="font-semibold text-green-600">{row.atendidas.toLocaleString('pt-BR')}</span></p>
                    <p>Em Aberto: <span className="font-semibold text-amber-500">{row.em_aberto.toLocaleString('pt-BR')}</span></p>
                    <p className="mt-1 border-t pt-1 text-muted-foreground">
                      Participacao no periodo: {formatPercent(calculateShare(row.total_ordens, totalOrdensPeriodo))}
                    </p>
                  </div>
                )
              }}
            />
            <Bar
              dataKey="pct_conclusao"
              radius={[0, 4, 4, 0]}
              onClick={(entry: ProdutividadeLoja) => setSelectedUnidade(entry.unidade)}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={getBarColor(entry.pct_conclusao)} />
              ))}
              {showLabels && (
                <LabelList
                  dataKey="pct_conclusao"
                  position="right"
                  style={CHART_VALUE_LABEL}
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
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
    </Card>
  )
}
