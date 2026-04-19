'use client'

import { memo } from 'react'
import { OrdersPriorityLane, PRIORITY_LANE_CONFIG } from '@/components/orders/orders-priority-lane'
import type { OrdemNotaAcompanhamento, OrderReassignTarget, OrdersWorkspaceHighlights } from '@/lib/types/database'

export interface OrdersWorkspaceHighlightsPanelProps {
  highlights: OrdersWorkspaceHighlights
  isLoading: boolean
  isFetching: boolean
  priorityTotals: { oldest: number; attention: number }
  highlightQuery: string
  canReassign: boolean
  reassignTargets: OrderReassignTarget[]
  onFilterOldest: () => void
  onFilterAttention: () => void
  onOpenDetails: (row: OrdemNotaAcompanhamento) => void
  onPrefetchDetails?: (row: OrdemNotaAcompanhamento) => void
  onReassigned: (args: { notaId: string; novoAdminId: string }) => void
}

export const OrdersWorkspaceHighlightsPanel = memo(function OrdersWorkspaceHighlightsPanel({
  highlights,
  isLoading,
  isFetching,
  priorityTotals,
  highlightQuery,
  canReassign,
  reassignTargets,
  onFilterOldest,
  onFilterAttention,
  onOpenDetails,
  onPrefetchDetails,
  onReassigned,
}: OrdersWorkspaceHighlightsPanelProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <OrdersPriorityLane
        title={PRIORITY_LANE_CONFIG.oldest.title}
        description={PRIORITY_LANE_CONFIG.oldest.description}
        emptyMessage={PRIORITY_LANE_CONFIG.oldest.emptyMessage}
        actionLabel={PRIORITY_LANE_CONFIG.oldest.actionLabel}
        total={priorityTotals.oldest}
        rows={highlights.oldest}
        loading={isLoading}
        refreshing={isFetching}
        icon={PRIORITY_LANE_CONFIG.oldest.icon}
        tone={PRIORITY_LANE_CONFIG.oldest.tone}
        highlightQuery={highlightQuery}
        canReassign={canReassign}
        reassignTargets={reassignTargets}
        onAction={onFilterOldest}
        onOpenDetails={onOpenDetails}
        onPrefetchDetails={onPrefetchDetails}
        onReassigned={onReassigned}
      />
      <OrdersPriorityLane
        title={PRIORITY_LANE_CONFIG.attention.title}
        description={PRIORITY_LANE_CONFIG.attention.description}
        emptyMessage={PRIORITY_LANE_CONFIG.attention.emptyMessage}
        actionLabel={PRIORITY_LANE_CONFIG.attention.actionLabel}
        total={priorityTotals.attention}
        rows={highlights.attention}
        loading={isLoading}
        refreshing={isFetching}
        icon={PRIORITY_LANE_CONFIG.attention.icon}
        tone={PRIORITY_LANE_CONFIG.attention.tone}
        highlightQuery={highlightQuery}
        canReassign={canReassign}
        reassignTargets={reassignTargets}
        onAction={onFilterAttention}
        onOpenDetails={onOpenDetails}
        onPrefetchDetails={onPrefetchDetails}
        onReassigned={onReassigned}
      />
    </div>
  )
})
