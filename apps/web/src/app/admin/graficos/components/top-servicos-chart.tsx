'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GestaoTopServico, TipoUnidade } from '@/lib/types/database'
import { ServicoOrdensDialog } from './servico-ordens-dialog'

interface TopServicosChartProps {
  data: GestaoTopServico[]
  ano?: number
  mes?: number
  tipoOrdem?: string
  tipoUnidade?: TipoUnidade
}

export function TopServicosChart({
  data,
  ano,
  mes,
  tipoOrdem,
  tipoUnidade,
}: TopServicosChartProps) {
  const [selectedServico, setSelectedServico] = useState<string | null>(null)
  const canOpenDrilldown = Boolean(tipoUnidade)

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Servicos Solicitados</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const topPercent = data[0]?.percentual ?? 0

  return (
    <>
      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">Servicos Solicitados</CardTitle>
          <p className="text-xs text-muted-foreground">
            Lider responde por {topPercent.toFixed(1)}% do total
          </p>
          {canOpenDrilldown && (
            <p className="text-xs text-muted-foreground">
              Clique em um servico para ver as ordens refletidas.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="w-12 px-4 py-3 text-right font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Servico</th>
                  <th className="px-4 py-3 text-right font-medium">Ordens</th>
                  <th className="px-4 py-3 text-right font-medium">% do total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, index) => {
                  const rowKey = `${row.texto_breve}-${index}`
                  const rowClasses = canOpenDrilldown
                    ? 'cursor-pointer hover:bg-muted/25'
                    : 'hover:bg-muted/15'

                  return (
                    <tr
                      key={rowKey}
                      className={`border-b transition-colors last:border-0 ${rowClasses}`}
                      onClick={canOpenDrilldown ? () => setSelectedServico(row.texto_breve) : undefined}
                    >
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td className="px-4 py-3">
                        {canOpenDrilldown ? (
                          <button
                            type="button"
                            className="text-left font-medium leading-5 text-foreground underline-offset-4 hover:underline"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedServico(row.texto_breve)
                            }}
                          >
                            {row.texto_breve}
                          </button>
                        ) : (
                          <p className="break-words font-medium leading-5">
                            {row.texto_breve}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {row.total_ordens.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium text-sky-600 dark:text-sky-400">
                          {row.percentual.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedServico && tipoUnidade && (
        <ServicoOrdensDialog
          servico={selectedServico}
          tipoUnidade={tipoUnidade}
          ano={ano}
          mes={mes}
          tipoOrdem={tipoOrdem}
          open={Boolean(selectedServico)}
          onClose={() => setSelectedServico(null)}
        />
      )}
    </>
  )
}
