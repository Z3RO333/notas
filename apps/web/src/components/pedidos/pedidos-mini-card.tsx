import { CheckCircle2, ShoppingCart, XCircle } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { resolveCargoPresentationFromEspecialidade } from '@/lib/collaborator/cargo-presentation'
import type { PedidosAdminSummary } from '@/lib/types/pedidos'
import type { Especialidade } from '@/lib/types/database'

interface PedidosMiniCardProps {
  admin: PedidosAdminSummary
  isExpanded: boolean
  onClick: () => void
}

export function PedidosMiniCard({ admin, isExpanded, onClick }: PedidosMiniCardProps) {
  const cargo = resolveCargoPresentationFromEspecialidade(
    (admin.especialidade ?? 'geral') as Especialidade
  )

  return (
    <CollaboratorCardShell
      variant="operational"
      name={admin.nome}
      avatarUrl={admin.avatar_url}
      cargo={cargo}
      active={isExpanded}
      onClick={onClick}
      accent={admin.em_aberto === 0 ? 'green' : 'none'}
      primaryMetric={{
        id: 'em_aberto',
        label: 'Em aberto',
        value: admin.em_aberto,
        tone: 'info',
        icon: ShoppingCart,
      }}
      secondaryMetrics={[
        {
          id: 'encerrado',
          label: 'Encerrado',
          value: admin.encerrado,
          tone: 'success',
          icon: CheckCircle2,
        },
        {
          id: 'cancelado',
          label: 'Cancelado',
          value: admin.cancelado,
          tone: 'danger',
          icon: XCircle,
        },
      ]}
    />
  )
}
