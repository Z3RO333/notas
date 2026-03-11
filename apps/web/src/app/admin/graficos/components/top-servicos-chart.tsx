import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GestaoTopServico } from '@/lib/types/database'

interface TopServicosChartProps {
  data: GestaoTopServico[]
}

export function TopServicosChart({ data }: TopServicosChartProps) {
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Servicos Solicitados</CardTitle>
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
              {data.map((row, index) => (
                <tr key={`${row.texto_breve}-${index}`} className="border-b transition-colors last:border-0 hover:bg-muted/15">
                  <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </td>
                  <td className="px-4 py-3">
                    <p className="break-words font-medium leading-5">
                      {row.texto_breve}
                    </p>
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
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
