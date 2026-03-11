import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FinanceiroRankingRow } from '@/lib/types/database'
import { formatCurrencyBRL } from '../financeiro-format'

interface FinanceiroRankingTableProps {
  title: string
  itemLabel: string
  data: FinanceiroRankingRow[]
}

export function FinanceiroRankingTable({ title, itemLabel, data }: FinanceiroRankingTableProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
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
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="w-12 px-4 py-3 text-right font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">{itemLabel}</th>
                <th className="px-4 py-3 text-right font-medium">Realizado</th>
                <th className="px-4 py-3 text-right font-medium">Pendente</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr
                  key={`${title}-${row.nome}-${index}`}
                  className="border-b transition-colors last:border-0 hover:bg-muted/15"
                >
                  <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </td>
                  <td className="px-4 py-3">
                    <p className="break-words font-medium leading-5">{row.nome}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="font-medium text-emerald-500">{formatCurrencyBRL(row.realizado)}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="font-medium text-amber-500">{formatCurrencyBRL(row.previsto_pendente)}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="font-semibold text-foreground">{formatCurrencyBRL(row.total)}</span>
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
