'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Clock3, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import type { OrdemNotaAcompanhamento, OrderReassignTarget } from '@/lib/types/database'

interface OrdersPriorityLaneProps {
  title: string
  description: string
  emptyMessage: string
  actionLabel: string
  total: number
  rows: OrdemNotaAcompanhamento[]
  icon: LucideIcon
  tone: 'danger' | 'warning'
  highlightQuery?: string
  canReassign: boolean
  reassignTargets: OrderReassignTarget[]
  onAction: () => void
  onOpenDetails: (row: OrdemNotaAcompanhamento) => void
  onReassigned: (result: { notaId: string; novoAdminId: string }) => void
}

const TONE_STYLES = {
  danger: {
    frame: 'border-red-300/70 bg-gradient-to-br from-red-50/90 via-background to-red-100/60 shadow-sm dark:border-red-900/70 dark:from-red-950/50 dark:via-slate-950 dark:to-red-950/20',
    badge: 'border-red-200 bg-white/95 text-red-700 shadow-sm dark:border-red-800 dark:bg-red-950/80 dark:text-red-100',
    iconWrap: 'bg-red-100 text-red-700 shadow-sm dark:bg-red-950/80 dark:text-red-100',
    empty: 'border-red-200/80 bg-background/80 dark:border-red-900/70 dark:bg-slate-950/70',
  },
  warning: {
    frame: 'border-amber-300/70 bg-gradient-to-br from-amber-50/95 via-background to-yellow-100/55 shadow-sm dark:border-amber-900/70 dark:from-amber-950/45 dark:via-slate-950 dark:to-yellow-950/15',
    badge: 'border-amber-200 bg-white/95 text-amber-700 shadow-sm dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-100',
    iconWrap: 'bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-950/80 dark:text-amber-100',
    empty: 'border-amber-200/80 bg-background/80 dark:border-amber-900/70 dark:bg-slate-950/70',
  },
} as const

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function OrdersPriorityLane({
  title,
  description,
  emptyMessage,
  actionLabel,
  total,
  rows,
  icon: Icon,
  tone,
  highlightQuery,
  canReassign,
  reassignTargets,
  onAction,
  onOpenDetails,
  onReassigned,
}: OrdersPriorityLaneProps) {
  const styles = TONE_STYLES[tone]
  const [expanded, setExpanded] = useState(false)
  const ToggleIcon = expanded ? ChevronUp : ChevronDown

  return (
    <section className={`rounded-xl border p-4 ${styles.frame}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-3 dark:border-white/5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${styles.iconWrap}`}>
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles.badge}`}>
            {formatNumber(total)} no escopo atual
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((current) => !current)}>
            <ToggleIcon className="h-4 w-4" />
            {expanded ? 'Minimizar' : 'Expandir'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>

      {!expanded ? (
        <div className="mt-3 text-xs text-muted-foreground">
          Painel minimizado. Clique em Expandir para ver as ordens.
        </div>
      ) : rows.length === 0 ? (
        <div className={`mt-3 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground ${styles.empty}`}>
          {emptyMessage}
        </div>
      ) : (
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {rows.map((row) => (
            <OrderCompactCard
              key={row.ordem_id}
              row={row}
              highlightQuery={highlightQuery}
              showReassign={canReassign && reassignTargets.length > 0}
              reassignProps={{
                currentAdminId: row.responsavel_atual_id,
                admins: reassignTargets,
                skipRouterRefresh: true,
                onReassigned,
              }}
              onOpenDetails={() => onOpenDetails(row)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export const PRIORITY_LANE_CONFIG = {
  oldest: {
    title: 'Ordens mais antigas',
    description: 'Carteira atrasada ha 7 dias ou mais, priorizando lojas e farmas; CDs entram depois.',
    emptyMessage: 'Nenhuma ordem atrasada encontrada neste escopo.',
    actionLabel: 'Filtrar atrasadas',
    icon: AlertTriangle,
    tone: 'danger',
  },
  attention: {
    title: 'Ordens que pedem atencao',
    description: 'Itens na faixa de 3 a 6 dias que merecem acompanhamento.',
    emptyMessage: 'Nenhuma ordem em faixa de atencao neste escopo.',
    actionLabel: 'Filtrar atencao',
    icon: Clock3,
    tone: 'warning',
  },
} as const
