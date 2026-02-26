import { format } from 'date-fns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { SyncLog } from '@/lib/types/database'

interface SyncHealthProps {
  logs: SyncLog[]
  adminsAtivos: number
  adminsTotal: number
  notasSemAtribuir: number
}

function getJobLabel(log: SyncLog): string {
  const metadata = log.metadata
  if (!metadata || typeof metadata !== 'object') return 'dispatcher'

  const job = (metadata as Record<string, unknown>).job
  if (typeof job !== 'string' || !job.trim()) return 'dispatcher'
  return job.toLowerCase()
}

function getLogCounters(log: SyncLog): string {
  return `${log.notas_lidas}/${log.notas_inseridas}/${log.notas_atualizadas}/${log.notas_distribuidas}`
}

export function SyncHealth({ logs, adminsAtivos, adminsTotal, notasSemAtribuir }: SyncHealthProps) {
  const lastSync = logs[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Saude do Sistema</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Ultimo sync</span>
            <span className="font-medium">
              {lastSync
                ? `${format(new Date(lastSync.started_at), 'dd/MM HH:mm')} (${lastSync.status})`
                : 'Nenhum'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Notas sem atribuir</span>
            <span className={`font-medium ${notasSemAtribuir > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {notasSemAtribuir}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Admins ativos</span>
            <span className="font-medium">{adminsAtivos}/{adminsTotal}</span>
          </div>
        </div>

        {logs.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Ultimos syncs</p>
            <div className="space-y-1">
              {logs.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {format(new Date(log.started_at), 'HH:mm')}
                  </span>
                  <span className="w-16 text-center font-mono text-[10px] uppercase text-muted-foreground">
                    {getJobLabel(log)}
                  </span>
                  <Badge variant={log.status === 'success' ? 'concluida' : log.status === 'error' ? 'cancelada' : 'em_andamento'}>
                    {log.status === 'success' ? 'OK' : log.status === 'error' ? 'ERRO' : 'EXEC'}
                  </Badge>
                  <span>
                    {getLogCounters(log)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">lidas/inseridas/atualizadas/distribuidas</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
