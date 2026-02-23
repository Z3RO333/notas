import { AlertTriangle, Clock3, TimerReset } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { resolveCargoPresentationFromOwner } from '@/lib/collaborator/cargo-presentation'
import type { OrderOwnerGroup } from '@/lib/types/database'

interface OrdersOwnerMiniCardProps {
  group: OrderOwnerGroup
  isExpanded: boolean
  onClick: () => void
}

export function OrdersOwnerMiniCard({
  group,
  isExpanded,
  onClick,
}: OrdersOwnerMiniCardProps) {
  const cargo = resolveCargoPresentationFromOwner({
    administrador_id: group.id,
    nome: group.nome,
    especialidade: group.especialidade ?? null,
  })

  return (
    <CollaboratorCardShell
      variant="operational"
      name={group.nome}
      avatarUrl={group.avatar_url}
      cargo={cargo}
      active={isExpanded}
      onClick={onClick}
      secondaryMetrics={[
        {
          id: 'recentes',
          label: '0-2d',
          value: group.recentes,
          tone: 'success',
          icon: TimerReset,
        },
        {
          id: 'atencao',
          label: '3-6d',
          value: group.atencao,
          tone: 'warning',
          icon: Clock3,
        },
        {
          id: 'atrasadas',
          label: '7+d',
          value: group.atrasadas,
          tone: 'danger',
          icon: AlertTriangle,
        },
      ]}
      summary={(
        <>
          <span className="text-base font-bold text-foreground">{group.total}</span>
          <span> de ordens</span>
        </>
      )}
    />
  )
}
