import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OrdemNotaRankingUnidade } from '@/lib/types/database'

interface OrdersRankingUnidadeProps {
  rows: OrdemNotaRankingUnidade[]
  periodLabel: string
}

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function OrdersRankingUnidade({ rows, periodLabel }: OrdersRankingUnidadeProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Ranking por unidade ({periodLabel})</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados para o periodo selecionado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Unidade</th>
                  <th className="pb-2 pr-3 font-medium">Ordens</th>
                  <th className="pb-2 pr-3 font-medium">Abertas</th>
                  <th className="pb-2 pr-3 font-medium">Tratativa</th>
                  <th className="pb-2 pr-3 font-medium">Atrasadas</th>
                  <th className="pb-2 pr-3 font-medium">Tempo medio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.unidade} className="border-b">
                    <td className="py-2.5 pr-3 font-medium">{row.unidade}</td>
                    <td className="py-2.5 pr-3">{fmt(row.qtd_ordens_30d)}</td>
                    <td className="py-2.5 pr-3">{fmt(row.qtd_abertas_30d)}</td>
                    <td className="py-2.5 pr-3">{fmt(row.qtd_em_tratativa_30d)}</td>
                    <td className="py-2.5 pr-3 text-red-700">{fmt(row.qtd_antigas_7d_30d)}</td>
                    <td className="py-2.5 pr-3">{row.tempo_medio_geracao_dias_30d === null ? '-' : `${row.tempo_medio_geracao_dias_30d.toFixed(1)} d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
