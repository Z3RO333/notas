import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { LojaOrdensIndicadoresRow } from '@/lib/types/indicadores'

function formatDias(value: number | null): string {
  if (value === null) return '-'
  return `${value.toFixed(1).replace('.', ',')}d`
}

interface LojaOrdensIndicadoresTableProps {
  rows: LojaOrdensIndicadoresRow[]
}

export function LojaOrdensIndicadoresTable({ rows }: LojaOrdensIndicadoresTableProps) {
  const destaque = rows[0]

  return (
    <Card className="border-border/60 bg-background/75">
      <CardHeader className="gap-3 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Por loja (ordem)</CardTitle>
          <CardDescription>
            Ordens fechadas (CONCLUIDO/CANCELADO) no período e mediana de dias de conclusão pela unidade da ordem.
          </CardDescription>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Unidades com ordens concluídas: {rows.length.toLocaleString('pt-BR')}
          </span>
          {destaque ? (
            <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
              Maior volume concluído: {destaque.unidade}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhuma ordem concluída por unidade no período.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                <tr className="border-y border-border/60">
                  <th className="w-14 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Unidade
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Concluídas
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    T. conclusão (mediana)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.unidade}
                    className="border-b border-border/60 align-middle transition-colors even:bg-muted/10 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-3 font-medium">{row.unidade}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.ordens_concluidas.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatDias(row.tempo_medio_conclusao)}
                    </td>
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
