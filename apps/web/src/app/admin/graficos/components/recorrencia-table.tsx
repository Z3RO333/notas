import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { GestaoRecorrencia } from '@/lib/types/database'

interface RecorrenciaTableProps {
  data: GestaoRecorrencia[]
}

function badgeVariant(qtd: number): 'default' | 'secondary' | 'destructive' {
  if (qtd > 15) return 'destructive'
  if (qtd >= 5) return 'secondary'
  return 'default'
}

export function RecorrenciaTable({ data }: RecorrenciaTableProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recorrência por Loja × Serviço</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sem dados para o período selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Recorrência por Loja × Serviço
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Lojas que mais repetem o mesmo tipo de serviço
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-8">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Loja</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Serviço</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={`${row.nome_loja}-${row.texto_breve}-${i}`}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium">{row.nome_loja}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.texto_breve}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge variant={badgeVariant(row.total_notas)}>
                      {row.total_notas}
                    </Badge>
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
