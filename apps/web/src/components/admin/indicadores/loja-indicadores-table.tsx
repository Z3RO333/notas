import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LojaIndicadoresRow } from '@/lib/types/indicadores'

function TaxaBadge({ taxa }: { taxa: number }) {
  const color =
    taxa >= 80 ? 'bg-green-500/10 text-green-400 border-green-500/20'
    : taxa >= 60 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>
      {taxa.toFixed(1).replace('.', ',')}%
    </span>
  )
}

interface LojaIndicadoresTableProps {
  rows: LojaIndicadoresRow[]
}

export function LojaIndicadoresTable({ rows }: LojaIndicadoresTableProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Por loja / unidade</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nenhuma unidade encontrada no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Unidade</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Notas</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Ordens</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Conversão</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.unidade} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">{row.unidade}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.total_notas.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.total_ordens.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-2 text-right"><TaxaBadge taxa={row.taxa_conversao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
