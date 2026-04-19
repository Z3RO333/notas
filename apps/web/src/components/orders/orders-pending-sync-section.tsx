'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCcw } from 'lucide-react'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
} from '@/lib/types/database'

interface OrdersPendingSyncSectionProps {
  rows: OrdemNotaAcompanhamento[]
  highlightQuery?: string
  canReassign?: boolean
  reassignTargets?: OrderReassignTarget[]
  onOpenDetails?: (row: OrdemNotaAcompanhamento) => void
  onPrefetchDetails?: (row: OrdemNotaAcompanhamento) => void
  onReassigned?: (payload: { notaId: string; novoAdminId: string }) => void
  collapsible?: boolean
  defaultCollapsed?: boolean
}

export function OrdersPendingSyncSection({
  rows,
  highlightQuery,
  canReassign = false,
  reassignTargets = [],
  onOpenDetails,
  onPrefetchDetails,
  onReassigned,
  collapsible = false,
  defaultCollapsed = false,
}: OrdersPendingSyncSectionProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed)

  useEffect(() => {
    setExpanded(!defaultCollapsed)
  }, [defaultCollapsed])

  if (rows.length === 0) return null

  return (
    <Card className="border-amber-300 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
      <CardHeader className={expanded || !collapsible ? 'pb-3' : 'pb-4'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCcw className="h-4 w-4 text-amber-700 dark:text-amber-300" />
              Aguardando confirmacao do sync
            </CardTitle>
            {(expanded || !collapsible) && (
              <p className="text-sm text-muted-foreground">
              Essas ordens ja aparecem aqui, mas so entram nos KPIs oficiais depois da confirmacao do sync.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-amber-300 bg-background/90 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-900/70 dark:bg-background dark:text-amber-200">
              {rows.length} {rows.length === 1 ? 'ordem' : 'ordens'}
            </span>

            {collapsible && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((current) => !current)}>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {expanded ? 'Recolher' : 'Expandir'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="grid gap-2 xl:grid-cols-2">
        {rows.map((row) => (
          <OrderCompactCard
            key={row.ordem_id}
            row={row}
            showReassign={canReassign}
            reassignProps={canReassign && reassignTargets.length > 0 ? {
              admins: reassignTargets,
              currentAdminId: row.responsavel_atual_id,
              skipRouterRefresh: true,
              onReassigned,
            } : undefined}
            onOpenDetails={onOpenDetails ? () => onOpenDetails(row) : undefined}
            onPrefetchDetails={onPrefetchDetails ? () => onPrefetchDetails(row) : undefined}
            notaLinkHref={row.nota_id ? `/notas/${row.nota_id}` : undefined}
            highlightQuery={highlightQuery}
          />
        ))}
        </CardContent>
      )}
    </Card>
  )
}
