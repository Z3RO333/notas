import type { ComponentType } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type CockpitKpiTone = 'neutral' | 'attention' | 'critical' | 'success'

export interface CockpitKpiItem {
  id: string
  label: string
  value: string
  helper?: string
  icon?: ComponentType<{ className?: string }>
  tone?: CockpitKpiTone
  active?: boolean
  onClick?: () => void
}

interface CockpitKpiStripProps {
  items: CockpitKpiItem[]
  loading?: boolean
  tone?: Exclude<CockpitKpiTone, 'neutral'>
  columnsClassName?: string
  className?: string
}

const frameToneClass: Record<Exclude<CockpitKpiTone, 'neutral'>, string> = {
  attention: 'border-amber-300 bg-amber-50/30 dark:border-amber-900/60 dark:bg-amber-950/20',
  critical: 'border-red-300 bg-red-50/30 dark:border-red-900/60 dark:bg-red-950/20',
  success: 'border-emerald-300 bg-emerald-50/25 dark:border-emerald-900/60 dark:bg-emerald-950/15',
}

const valueToneClass: Record<CockpitKpiTone, string> = {
  neutral: 'text-foreground',
  attention: 'text-amber-700 dark:text-amber-300',
  critical: 'text-red-700 dark:text-red-300',
  success: 'text-emerald-700 dark:text-emerald-300',
}

export function CockpitKpiStrip({
  items,
  loading = false,
  tone,
  columnsClassName,
  className,
}: CockpitKpiStripProps) {
  return (
    <div className={cn('rounded-lg border bg-background/40 p-2', tone && frameToneClass[tone], className)}>
      <div className={cn('grid grid-cols-2 gap-2 xl:grid-cols-4', columnsClassName)}>
        {items.map((item) => {
          const Icon = item.icon
          const content = (
            <div
              className={cn(
                'flex h-full min-h-[5.75rem] flex-col justify-between rounded-md border bg-card px-3 py-2.5 text-left shadow-sm transition-colors',
                item.active
                  ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border/80 hover:bg-muted/30',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">{item.label}</p>
                {Icon ? <Icon className={cn('h-4 w-4 shrink-0', valueToneClass[item.tone ?? 'neutral'])} /> : null}
              </div>

              <div className="mt-2">
                {loading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <p className={cn('truncate text-2xl font-semibold leading-8 tracking-normal', valueToneClass[item.tone ?? 'neutral'])}>
                    {item.value}
                  </p>
                )}
                <p className="mt-1 min-h-4 truncate text-[11px] leading-4 text-muted-foreground">
                  {item.helper ?? (item.active ? 'Filtro ativo' : '')}
                </p>
              </div>
            </div>
          )

          if (!item.onClick) {
            return <div key={item.id}>{content}</div>
          }

          return (
            <button
              key={item.id}
              type="button"
              className="h-full min-w-0 disabled:cursor-default"
              onClick={item.onClick}
              disabled={loading}
            >
              {content}
            </button>
          )
        })}
      </div>
    </div>
  )
}
