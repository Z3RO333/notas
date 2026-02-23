export type CollaboratorCardVariant = 'operational' | 'compact'
export type CollaboratorMetricTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const COLLABORATOR_CARD_TOKENS = {
  base: 'rounded-lg border bg-card',
  interactive: 'cursor-pointer transition-all hover:shadow-md',
  active: 'ring-2 ring-primary bg-primary/5',
  dimmed: 'opacity-60 grayscale',
  accent: {
    none: '',
    orange: 'border-orange-200 bg-orange-50/30',
    red: 'border-red-200 bg-red-50/30',
  },
  variant: {
    operational: {
      card: 'p-3 space-y-2.5',
      name: 'text-sm font-semibold',
      headerGap: 'gap-2.5',
      avatarSize: 'md',
      primaryValue: 'text-xl',
      primaryLabel: 'text-[11px]',
      metricValue: 'text-sm font-bold',
      metricLabel: 'text-[10px] font-medium',
    },
    compact: {
      card: 'p-3 space-y-2',
      name: 'text-sm font-semibold',
      headerGap: 'gap-2.5',
      avatarSize: 'sm',
      primaryValue: 'text-lg',
      primaryLabel: 'text-[10px]',
      metricValue: 'text-xs font-bold',
      metricLabel: 'text-[10px] font-medium',
    },
  },
  cargoBadge: 'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
  statusBadge: 'inline-flex items-center rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600',
  primaryMetric: 'rounded-md px-2.5 py-2',
  metricGrid: 'grid gap-1.5',
  metricItem: 'rounded px-1.5 py-1 text-center',
  summary: 'rounded bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700',
} as const

export const METRIC_TONE_STYLES: Record<CollaboratorMetricTone, {
  container: string
  value: string
  label: string
  icon: string
}> = {
  neutral: {
    container: 'bg-slate-100',
    value: 'text-slate-700',
    label: 'text-slate-600',
    icon: 'text-slate-600',
  },
  success: {
    container: 'bg-emerald-50',
    value: 'text-emerald-700',
    label: 'text-emerald-700',
    icon: 'text-emerald-700',
  },
  warning: {
    container: 'bg-amber-50',
    value: 'text-amber-700',
    label: 'text-amber-700',
    icon: 'text-amber-700',
  },
  danger: {
    container: 'bg-red-50',
    value: 'text-red-700',
    label: 'text-red-700',
    icon: 'text-red-700',
  },
  info: {
    container: 'bg-blue-50',
    value: 'text-blue-700',
    label: 'text-blue-700',
    icon: 'text-blue-700',
  },
}
