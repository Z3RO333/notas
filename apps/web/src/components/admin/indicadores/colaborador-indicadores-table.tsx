import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ColaboradorIndicadoresRow } from '@/lib/types/indicadores'

function formatDias(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1).replace('.', ',')}d`
}

function TaxaBadge({ taxa }: { taxa: number }) {
  const color =
    taxa >= 80 ? 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-300'
    : taxa >= 60 ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300'
    : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300'

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>
      {taxa.toFixed(1).replace('.', ',')}%
    </span>
  )
}

interface ColaboradorIndicadoresTableProps {
  rows: ColaboradorIndicadoresRow[]
}

export function ColaboradorIndicadoresTable({ rows }: ColaboradorIndicadoresTableProps) {
  const destaque = rows[0]

  return (
    <Card className="border-border/60 bg-background/75">
      <CardHeader className="gap-3 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Por colaborador</CardTitle>
          <CardDescription>
            Ranking da equipe por volume recebido, conversao em ordem e tempo medio para gerar ordem.
          </CardDescription>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Colaboradores no recorte: {rows.length.toLocaleString('pt-BR')}
          </span>
          {destaque ? (
            <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
              Lider em volume: {destaque.nome}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhum colaborador encontrado no periodo.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                <tr className="border-y border-border/60">
                  <th className="w-14 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Colaborador
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Notas
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Convertidas
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Conversao
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    T. medio
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.administrador_id}
                    className="border-b border-border/60 align-middle transition-colors even:bg-muted/10 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-3 font-medium">{row.nome}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.total_notas.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.notas_convertidas.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right">
                      <TaxaBadge taxa={row.taxa_conversao} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatDias(row.tempo_medio_nota_ordem)}
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
