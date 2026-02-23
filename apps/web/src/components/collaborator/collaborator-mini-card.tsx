import { AlertTriangle, Clock3, Sparkles, StickyNote } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { COLLABORATOR_CARD_TOKENS } from '@/components/collaborator/collaborator-card-tokens'
import {
  resolveCargoPresentationFromEspecialidade,
  getCargoPresentationByLabel,
  type CollaboratorCargoLabel,
} from '@/lib/collaborator/cargo-presentation'
import type { CollaboratorData } from '@/lib/types/collaborator'

interface CollaboratorMiniCardProps {
  collaborator: CollaboratorData
  isExpanded: boolean
  onClick: () => void
  forceCargoLabel?: CollaboratorCargoLabel
}

function getUnavailableLabel(c: CollaboratorData): string | null {
  if (c.id === 'sem-atribuir') return null
  if (!c.ativo) return 'Inativo'
  if (c.em_ferias) return 'Em férias'
  if (!c.recebe_distribuicao) return 'Pausado'
  return null
}

export function CollaboratorMiniCard({
  collaborator,
  isExpanded,
  onClick,
  forceCargoLabel,
}: CollaboratorMiniCardProps) {
  const cargo = forceCargoLabel
    ? getCargoPresentationByLabel(forceCargoLabel)
    : resolveCargoPresentationFromEspecialidade(collaborator.especialidade)
  const unavailable = getUnavailableLabel(collaborator)

  return (
    <CollaboratorCardShell
      variant="operational"
      name={collaborator.nome}
      avatarUrl={collaborator.avatar_url}
      cargo={cargo}
      active={isExpanded}
      onClick={onClick}
      dimmed={Boolean(unavailable)}
      statusBadges={unavailable ? (
        <span className={COLLABORATOR_CARD_TOKENS.statusBadge}>{unavailable}</span>
      ) : null}
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
    />
  )
}
