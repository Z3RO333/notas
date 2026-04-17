import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ColaboradorOrdensIndicadoresRow } from '@/lib/types/indicadores'

function formatDias(value: number | null): string {
  if (value === null) return '-'
  return `${value.toFixed(1).replace('.', ',')}d`
}

interface ColaboradorOrdensIndicadoresTableProps {
  rows: ColaboradorOrdensIndicadoresRow[]
}

export function ColaboradorOrdensIndicadoresTable({ rows }: ColaboradorOrdensIndicadoresTableProps) {
  const destaque = rows[0]

  return (
    <Card className="border-border/60 bg-background/75">
      <CardHeader className="gap-3 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Por colaborador (ordem)</CardTitle>
          <CardDescription>
            Ranking por ordens concluidas no periodo e tempo medio de conclusao por responsavel atual.
          </CardDescription>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            Colaboradores com ordens concluidas: {rows.length.toLocaleString('pt-BR')}
          </span>
          {destaque ? (
            <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
              Lider em conclusoes: {destaque.nome}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhum colaborador com ordem concluida no periodo.</p>
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
                    Concluidas
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    T. conclusao
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
