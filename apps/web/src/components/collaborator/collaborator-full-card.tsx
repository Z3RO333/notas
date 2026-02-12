import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { NotaStatusBadge } from '@/components/notas/nota-status-badge'
import { getAgingBadge, getAgingBucket, getAgingDays, isOpenStatus } from '@/lib/collaborator/aging'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { Especialidade, NotaPanelData, OrdemAcompanhamento } from '@/lib/types/database'

interface CollaboratorFullCardProps {
  collaborator: CollaboratorData
  notas: NotaPanelData[]
  adminActions?: React.ReactNode
  trackingOrders?: OrdemAcompanhamento[]
}

const especialidadeConfig: Record<Especialidade, { label: string; color: string }> = {
  refrigeracao: { label: 'Refrigeracao', color: 'bg-cyan-100 text-cyan-800' },
  elevadores: { label: 'Elevadores/Geradores', color: 'bg-orange-100 text-orange-800' },
  geral: { label: 'Geral', color: 'bg-gray-100 text-gray-800' },
}

function sortByUrgency(notas: NotaPanelData[]): NotaPanelData[] {
  return [...notas].sort((a, b) => {
    const aOpen = isOpenStatus(a.status) ? 1 : 0
    const bOpen = isOpenStatus(b.status) ? 1 : 0
    if (aOpen !== bOpen) return bOpen - aOpen

    const diff = getAgingDays(b) - getAgingDays(a)
    if (diff !== 0) return diff
    return a.numero_nota.localeCompare(b.numero_nota)
  })
}

export function CollaboratorFullCard({
  collaborator,
  notas,
  adminActions,
  trackingOrders,
}: CollaboratorFullCardProps) {
  const esp = especialidadeConfig[collaborator.especialidade] ?? especialidadeConfig.geral
  const percentual = collaborator.max_notas > 0
    ? Math.round((collaborator.qtd_abertas / collaborator.max_notas) * 100)
    : 0
  const barColor = percentual > 80 ? 'bg-red-500' : percentual > 50 ? 'bg-yellow-500' : 'bg-green-500'
  const previewNotas = sortByUrgency(notas).slice(0, 6)

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={collaborator.avatar_url} nome={collaborator.nome} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{collaborator.nome}</p>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${esp.color}`}>{esp.label}</span>
        </div>
      </div>

      {adminActions && <div className="border-b pb-3">{adminActions}</div>}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-emerald-50 px-2 py-1">
          <p className="text-lg font-bold text-emerald-700">{collaborator.qtd_novo}</p>
          <p className="text-[11px] text-emerald-700">Novo</p>
        </div>
        <div className="rounded bg-amber-50 px-2 py-1">
          <p className="text-lg font-bold text-amber-700">{collaborator.qtd_1_dia}</p>
          <p className="text-[11px] text-amber-700">1 dia</p>
        </div>
        <div className="rounded bg-red-50 px-2 py-1">
          <p className="text-lg font-bold text-red-700">{collaborator.qtd_2_mais}</p>
          <p className="text-[11px] text-red-700">2+ dias</p>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{collaborator.qtd_abertas} abertas de {collaborator.max_notas}</span>
          <span>{percentual}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(percentual, 100)}%` }} />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Notas distribuidas</p>
        {previewNotas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma nota em aberto.</p>
        ) : (
          <div className="space-y-1.5">
            {previewNotas.map((nota) => {
              const aging = isOpenStatus(nota.status)
                ? getAgingBadge(getAgingBucket(nota))
                : {
                    label: nota.status === 'concluida' ? 'Concluida' : 'Cancelada',
                    chip: 'bg-slate-100 text-slate-600',
                  }
              return (
                <Link
                  key={nota.id}
                  href={`/notas/${nota.id}`}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                >
                  <span className="font-mono font-medium">#{nota.numero_nota}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${aging.chip}`}>
                      {aging.label}
                    </span>
                    <NotaStatusBadge status={nota.status} />
                  </div>
                </Link>
              )
            })}
            {notas.length > previewNotas.length && (
              <p className="text-center text-xs text-muted-foreground">
                +{notas.length - previewNotas.length} mais
              </p>
            )}
          </div>
        )}
      </div>

      {trackingOrders && trackingOrders.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground">Ordens em acompanhamento</p>
          {trackingOrders.slice(0, 4).map((order) => (
            <Link
              key={order.acompanhamento_id}
              href={`/notas/${order.nota_id}`}
              className="flex items-center justify-between rounded px-1 py-1 text-xs hover:bg-muted/50"
            >
              <span className="font-mono">#{order.numero_nota}</span>
              <span className="text-muted-foreground">{order.ordem_gerada}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}
