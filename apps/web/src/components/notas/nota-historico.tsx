import { format } from 'date-fns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { NotaHistorico } from '@/lib/types/database'

interface NotaHistoricoProps {
  historico: NotaHistorico[]
}

function formatCampo(campo: string): string {
  const map: Record<string, string> = {
    status: 'Status',
    administrador_id: 'Responsável',
  }
  return map[campo] || campo
}

function formatValor(campo: string, valor: string | null): string {
  if (!valor || valor === 'NULL') return '-'
  if (campo === 'status') {
    const labels: Record<string, string> = {
      nova: 'Nova',
      em_andamento: 'Em Andamento',
      encaminhada_fornecedor: 'Encaminhada',
      concluida: 'Concluída',
      cancelada: 'Cancelada',
    }
    return labels[valor] || valor
  }
  return valor
}

export function NotaHistoricoTimeline({ historico }: NotaHistoricoProps) {
  if (historico.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Histórico</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {historico.map((item) => (
            <div key={item.id} className="flex gap-4 border-l-2 border-muted pl-4">
              <div className="flex-1">
                <p className="text-sm">
                  <span className="font-medium">{formatCampo(item.campo_alterado)}</span>
                  {': '}
                  <span className="text-muted-foreground">
                    {formatValor(item.campo_alterado, item.valor_anterior)}
                  </span>
                  {' → '}
                  <span className="font-medium">
                    {formatValor(item.campo_alterado, item.valor_novo)}
                  </span>
                </p>
                {item.motivo && (
                  <p className="text-xs text-muted-foreground mt-1">{item.motivo}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(item.created_at), 'dd/MM/yyyy HH:mm')}
                  {item.administradores?.nome && ` - ${item.administradores.nome}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
