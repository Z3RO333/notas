import type { ComponentType, ReactNode } from 'react'
import {
  BarChart3,
  Building2,
  Snowflake,
  UserX,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import {
  COLLABORATOR_CARD_TOKENS,
  METRIC_TONE_STYLES,
  type CollaboratorCardVariant,
  type CollaboratorMetricTone,
} from '@/components/collaborator/collaborator-card-tokens'
import type {
  CollaboratorCargoIconKey,
  CollaboratorCargoPresentation,
} from '@/lib/collaborator/cargo-presentation'
import { cn } from '@/lib/utils'

export interface CollaboratorCardMetric {
  id: string
  label: string
  value: ReactNode
  tone?: CollaboratorMetricTone
  icon?: ComponentType<{ className?: string }>
}

interface CollaboratorCardShellProps {
  variant?: CollaboratorCardVariant
  name: string
  avatarUrl?: string | null
  avatarSize?: 'sm' | 'md' | 'lg' | 'xl'
  cargo: CollaboratorCargoPresentation
  statusBadges?: ReactNode
  headerRight?: ReactNode
  topSlot?: ReactNode
  primaryMetric?: CollaboratorCardMetric
  secondaryMetrics?: CollaboratorCardMetric[]
  summary?: ReactNode
  details?: ReactNode
  onClick?: () => void
  active?: boolean
  dimmed?: boolean
  accent?: 'none' | 'orange' | 'red'
  className?: string
}

const CARGO_ICON_BY_KEY: Record<CollaboratorCargoIconKey, ComponentType<{ className?: string }>> = {
  wrench: Wrench,
  snowflake: Snowflake,
  building: Building2,
  warehouse: Warehouse,
  users: Users,
  'user-x': UserX,
}

function renderMetric(
  metric: CollaboratorCardMetric,
  variant: CollaboratorCardVariant,
  isPrimary: boolean
): ReactNode {
  const tone = METRIC_TONE_STYLES[metric.tone ?? 'neutral']
  const Icon = metric.icon ?? BarChart3
  const variantTokens = COLLABORATOR_CARD_TOKENS.variant[variant]

  if (isPrimary) {
    return (
      <div className={cn(COLLABORATOR_CARD_TOKENS.primaryMetric, tone.container)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn('inline-flex items-center gap-1', variantTokens.primaryLabel, tone.label)}>
            <Icon className={cn('h-3 w-3', tone.icon)} />
            {metric.label}
          </span>
          <span className={cn(variantTokens.primaryValue, 'font-bold', tone.value)}>{metric.value}</span>
        </div>
      </div>
    )
  }

  return (
    <div key={metric.id} className={cn(COLLABORATOR_CARD_TOKENS.metricItem, tone.container)}>
      <div className="flex items-center justify-center gap-1">
        <Icon className={cn('h-3 w-3', tone.icon)} />
        <span className={cn(variantTokens.metricValue, tone.value)}>{metric.value}</span>
      </div>
      <p className={cn(variantTokens.metricLabel, tone.label)}>{metric.label}</p>
    </div>
  )
}

export function CollaboratorCardShell({
  variant = 'operational',
  name,
  avatarUrl,
  avatarSize,
  cargo,
  statusBadges,
  headerRight,
  topSlot,
  primaryMetric,
  secondaryMetrics = [],
  summary,
  details,
  onClick,
  active = false,
  dimmed = false,
  accent = 'none',
  className,
}: CollaboratorCardShellProps) {
  const variantTokens = COLLABORATOR_CARD_TOKENS.variant[variant]
  const CargoIcon = CARGO_ICON_BY_KEY[cargo.iconKey]
  const resolvedAccent = cargo.label === 'SEM RESPONSÁVEL' ? 'orange' : accent

  return (
    <Card
      onClick={onClick}
      className={cn(
        COLLABORATOR_CARD_TOKENS.base,
        variantTokens.card,
        onClick ? COLLABORATOR_CARD_TOKENS.interactive : '',
        active ? COLLABORATOR_CARD_TOKENS.active : '',
        dimmed ? COLLABORATOR_CARD_TOKENS.dimmed : '',
        COLLABORATOR_CARD_TOKENS.accent[resolvedAccent],
        className
      )}
    >
      <div className={cn('flex items-start justify-between', variantTokens.headerGap)}>
        <div className={cn('flex min-w-0 flex-1 items-center', variantTokens.headerGap)}>
          <Avatar src={avatarUrl} nome={name} size={avatarSize ?? variantTokens.avatarSize} />

          <div className="min-w-0">
            <p className={cn('truncate', variantTokens.name)}>{name}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span className={cn(COLLABORATOR_CARD_TOKENS.cargoBadge, cargo.badgeClassName)}>
                <CargoIcon className="h-3 w-3" />
                {cargo.label}
              </span>
              {statusBadges}
            </div>
          </div>
        </div>

        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>

      {topSlot}

      {primaryMetric && renderMetric(primaryMetric, variant, true)}

      {secondaryMetrics.length > 0 && (
        <div
          className={COLLABORATOR_CARD_TOKENS.metricGrid}
          style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(secondaryMetrics.length, 1), 4)}, minmax(0, 1fr))` }}
        >
          {secondaryMetrics.map((metric) => renderMetric(metric, variant, false))}
        </div>
      )}

      {summary && (
        <div className={COLLABORATOR_CARD_TOKENS.summary}>{summary}</div>
      )}

      {details}
    </Card>
  )
}
