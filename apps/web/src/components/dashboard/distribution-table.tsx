import Link from 'next/link'
import { format } from 'date-fns'
import { Card } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import type { CargaAdministrador, NotaConcluida, Especialidade } from '@/lib/types/database'

interface DistributionTableProps {
  carga: CargaAdministrador[]
  notasConcluidas: NotaConcluida[]
}

const especialidadeConfig: Record<Especialidade, { label: string; color: string }> = {
  refrigeracao: { label: 'Refrigeracao', color: 'bg-cyan-100 text-cyan-800' },
  elevadores: { label: 'Elevadores/Geradores', color: 'bg-orange-100 text-orange-800' },
  geral: { label: 'Geral', color: 'bg-gray-100 text-gray-800' },
}

export function DistributionTable({ carga, notasConcluidas }: DistributionTableProps) {
  // Agrupa notas concluidas por admin
  const concluidasByAdmin = new Map<string, NotaConcluida[]>()
  for (const nota of notasConcluidas) {
    const list = concluidasByAdmin.get(nota.administrador_id) ?? []
    list.push(nota)
    concluidasByAdmin.set(nota.administrador_id, list)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Distribuicao por Admin</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {carga.map((admin) => {
          const percentual = admin.max_notas > 0
            ? Math.round((admin.qtd_abertas / admin.max_notas) * 100)
            : 0
          const esp = especialidadeConfig[admin.especialidade] || especialidadeConfig.geral
          const barColor = percentual > 80 ? 'bg-red-500' : percentual > 50 ? 'bg-yellow-500' : 'bg-green-500'
          const adminConcluidas = concluidasByAdmin.get(admin.id) ?? []

          return (
            <Card key={admin.id} className={`p-5 flex flex-col items-center gap-3 ${!admin.ativo ? 'opacity-50' : ''}`}>
              <Avatar src={admin.avatar_url} nome={admin.nome} size="xl" />

              <div className="text-center">
                <p className="font-semibold text-base">{admin.nome}</p>
                {!admin.ativo && (
                  <span className="text-xs text-muted-foreground">(inativo)</span>
                )}
              </div>

              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${esp.color}`}>
                {esp.label}
              </span>

              <div className="grid grid-cols-3 gap-2 w-full text-center">
                <div className="rounded-lg bg-blue-50 px-2 py-1.5">
                  <p className="text-lg font-bold text-blue-700">{admin.qtd_nova}</p>
                  <p className="text-[10px] text-blue-600">Novas</p>
                </div>
                <div className="rounded-lg bg-yellow-50 px-2 py-1.5">
                  <p className="text-lg font-bold text-yellow-700">{admin.qtd_em_andamento}</p>
                  <p className="text-[10px] text-yellow-600">Em And.</p>
                </div>
                <div className="rounded-lg bg-purple-50 px-2 py-1.5">
                  <p className="text-lg font-bold text-purple-700">{admin.qtd_encaminhada}</p>
                  <p className="text-[10px] text-purple-600">Encam.</p>
                </div>
              </div>

              <div className="w-full space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{admin.qtd_abertas} abertas de {admin.max_notas}</span>
                  <span className="font-medium">{percentual}%</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-muted">
                  <div
                    className={`h-2.5 rounded-full transition-all ${barColor}`}
                    style={{ width: `${Math.min(percentual, 100)}%` }}
                  />
                </div>
              </div>

              {/* Notas concluidas deste admin */}
              {adminConcluidas.length > 0 && (
                <div className="w-full border-t pt-3 space-y-1">
                  <p className="text-xs font-medium text-green-600 mb-1.5">
                    {admin.qtd_concluidas} concluida{admin.qtd_concluidas !== 1 ? 's' : ''}
                  </p>
                  {adminConcluidas.slice(0, 5).map((nota) => (
                    <Link
                      key={nota.id}
                      href={`/notas/${nota.id}`}
                      className="flex items-center justify-between text-xs hover:bg-muted/50 rounded px-1.5 py-1 transition-colors"
                    >
                      <span className="font-mono font-medium text-foreground">#{nota.numero_nota}</span>
                      <span className="text-muted-foreground">
                        {format(new Date(nota.updated_at), 'dd/MM')}
                      </span>
                    </Link>
                  ))}
                  {adminConcluidas.length > 5 && (
                    <p className="text-[10px] text-center text-muted-foreground">
                      +{adminConcluidas.length - 5} mais
                    </p>
                  )}
                </div>
              )}

              {admin.qtd_concluidas > 0 && adminConcluidas.length === 0 && (
                <p className="text-xs text-green-600 font-medium">
                  {admin.qtd_concluidas} concluida{admin.qtd_concluidas !== 1 ? 's' : ''}
                </p>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
