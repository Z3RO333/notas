import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import type { CargaAdministrador, Especialidade } from '@/lib/types/database'

interface DistributionTableProps {
  carga: CargaAdministrador[]
}

const especialidadeConfig: Record<Especialidade, { label: string; color: string }> = {
  refrigeracao: { label: 'Refrigeracao', color: 'bg-cyan-100 text-cyan-800' },
  elevadores: { label: 'Elevadores/Geradores', color: 'bg-orange-100 text-orange-800' },
  geral: { label: 'Geral', color: 'bg-gray-100 text-gray-800' },
}

export function DistributionTable({ carga }: DistributionTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Distribuicao por Admin</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Admin</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Especialidade</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Novas</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Em And.</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Encam.</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Abertas</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Max</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">% Carga</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Concl.</th>
              </tr>
            </thead>
            <tbody>
              {carga.map((admin) => {
                const percentual = admin.max_notas > 0
                  ? Math.round((admin.qtd_abertas / admin.max_notas) * 100)
                  : 0
                const esp = especialidadeConfig[admin.especialidade] || especialidadeConfig.geral
                return (
                  <tr key={admin.id} className="border-b">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={admin.avatar_url} nome={admin.nome} size="sm" />
                        <div>
                          <p className="text-sm font-medium">{admin.nome}</p>
                          {!admin.ativo && (
                            <span className="text-xs text-muted-foreground">(inativo)</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${esp.color}`}>
                        {esp.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">{admin.qtd_nova}</td>
                    <td className="px-4 py-3 text-center text-sm">{admin.qtd_em_andamento}</td>
                    <td className="px-4 py-3 text-center text-sm">{admin.qtd_encaminhada}</td>
                    <td className="px-4 py-3 text-center text-sm font-bold">{admin.qtd_abertas}</td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">{admin.max_notas}</td>
                    <td className="px-4 py-3 text-center text-sm">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted">
                          <div
                            className={`h-2 rounded-full ${
                              percentual > 80 ? 'bg-red-500' : percentual > 50 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(percentual, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs">{percentual}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-green-600">{admin.qtd_concluidas}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
