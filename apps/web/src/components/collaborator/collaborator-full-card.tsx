import Link from 'next/link'
import { AlertTriangle, Clock3, Sparkles, StickyNote } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { NotaListItem } from '@/components/painel/nota-list-item'
import { getAgingDays, isOpenStatus } from '@/lib/collaborator/aging'
import {
  getCargoPresentationByLabel,
  resolveCargoPresentationFromEspecialidade,
  type CollaboratorCargoLabel,
} from '@/lib/collaborator/cargo-presentation'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData, OrdemAcompanhamento } from '@/lib/types/database'

interface CollaboratorFullCardProps {
  collaborator: CollaboratorData
  notas: NotaPanelData[]
  adminActions?: React.ReactNode
  trackingOrders?: OrdemAcompanhamento[]
  forceCargoLabel?: CollaboratorCargoLabel
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
  forceCargoLabel,
}: CollaboratorFullCardProps) {
  const cargo = forceCargoLabel
    ? getCargoPresentationByLabel(forceCargoLabel)
    : resolveCargoPresentationFromEspecialidade(collaborator.especialidade)
  const sortedNotas = sortByUrgency(notas)

  const details = (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Notas distribuidas</p>
        {sortedNotas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma nota em aberto.</p>
        ) : (
          <div className="max-h-[24rem] space-y-1.5 overflow-y-auto pr-1">
            {sortedNotas.map((nota) => (
              <NotaListItem key={nota.id} nota={nota} />
            ))}
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
    </div>
  )

  return (
    <CollaboratorCardShell
      variant="operational"
      name={collaborator.nome}
      avatarUrl={collaborator.avatar_url}
      avatarSize="lg"
      cargo={cargo}
      topSlot={adminActions ? <div className="border-b pb-3">{adminActions}</div> : null}
      primaryMetric={{
        id: 'abertas',
        label: 'Notas abertas',
        value: collaborator.qtd_abertas,
        tone: 'info',
        icon: StickyNote,
      }}
      secondaryMetrics={[
        {
          id: 'novo',
          label: 'Novo',
          value: collaborator.qtd_novo,
          tone: 'success',
          icon: Sparkles,
        },
        {
          id: 'um-dia',
          label: '1 dia',
          value: collaborator.qtd_1_dia,
          tone: 'warning',
          icon: Clock3,
        },
        {
          id: 'dois-mais',
          label: '2+ dias',
          value: collaborator.qtd_2_mais,
          tone: 'danger',
          icon: AlertTriangle,
        },
      ]}
      details={details}
    />
  )
}
