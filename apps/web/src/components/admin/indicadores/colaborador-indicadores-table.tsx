import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ColaboradorIndicadoresRow } from '@/lib/types/indicadores'

interface ColaboradorIndicadoresTableProps {
  rows: ColaboradorIndicadoresRow[]
}

export function ColaboradorIndicadoresTable({ rows }: ColaboradorIndicadoresTableProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Por colaborador</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum colaborador encontrado no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Colaborador</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Notas</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Conversão</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">T. médio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.administrador_id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">{row.nome}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.total_notas.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.taxa_conversao.toFixed(1).replace('.', ',')}%
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {row.tempo_medio_nota_ordem !== null
                      ? `${row.tempo_medio_nota_ordem.toFixed(1).replace('.', ',')}d`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
