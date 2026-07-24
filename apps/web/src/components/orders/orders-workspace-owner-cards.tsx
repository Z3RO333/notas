'use client'

import { memo, useState } from 'react'
import { AlertTriangle, ChevronDown, Clock3, LayoutGrid, Loader2, Rows3, TimerReset } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { OrdersOwnerFullCard } from '@/components/orders/orders-owner-full-card'
import { OrdersPoolCard } from '@/components/orders/orders-pool-card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { resolveCargoPresentationFromOwner } from '@/lib/collaborator/cargo-presentation'
import { toOrderOwnerKey } from '@/lib/orders/owner-visibility'
import type {
  Especialidade,
  OrderOwnerGroup,
  OrderReassignTarget,
  OrdersOwnerSummary,
  OrdersPoolGroup,
  OrdersWorkspaceCursor,
  PanelViewMode,
} from '@/lib/types/database'

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

export interface OrdersWorkspaceOwnerCardsProps {
  viewMode: PanelViewMode
  showOwnerToolbar: boolean
  isViewerMode: boolean
  canViewGlobal: boolean
  semResponsavel: number
  visibleOwners: OrdersOwnerSummary[]
  activeResponsavel: string
  isPrivateScope: boolean
  ownerEspecialidadeById: Map<string, Especialidade | null>
  ownerGroups: OrderOwnerGroup[]
  poolGroupsWithRows: OrdersPoolGroup[]
  canReassign: boolean
  reassignTargets: OrderReassignTarget[]
  selectedNotaIds: Set<string>
  nextCursor: OrdersWorkspaceCursor | null
  loadingMore: boolean
  rowsCount: number
  defaultCollapsed?: boolean
  onViewModeChange: (value: string) => void
  onFilterUnassigned: () => void
  onFilterAll: () => void
  onToggleOwner: (ownerKey: string) => void
  onToggleSelection: (notaId: string, shiftKey?: boolean) => void
  onLoadMore: () => void
}

export const OrdersWorkspaceOwnerCards = memo(function OrdersWorkspaceOwnerCards({
  viewMode,
  showOwnerToolbar,
  isViewerMode,
  canViewGlobal,
  semResponsavel,
  visibleOwners,
  activeResponsavel,
  isPrivateScope,
  ownerEspecialidadeById,
  ownerGroups,
  poolGroupsWithRows,
  canReassign,
  reassignTargets,
  selectedNotaIds,
  nextCursor,
  loadingMore,
  rowsCount,
  defaultCollapsed = false,
  onViewModeChange,
  onFilterUnassigned,
  onFilterAll,
  onToggleOwner,
  onToggleSelection,
  onLoadMore,
}: OrdersWorkspaceOwnerCardsProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const contentCollapsed = isViewerMode ? false : collapsed

  return (
    <div className="rounded-lg border p-3">
      <div className={contentCollapsed ? 'flex items-center justify-between gap-2' : 'mb-3 flex items-center justify-between gap-2'}>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Carteira por colaborador</p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(visibleOwners.length)} colaborador{visibleOwners.length !== 1 ? 'es' : ''} no escopo atual
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isViewerMode && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={!contentCollapsed}
              aria-controls="orders-owner-cards-content"
              onClick={() => setCollapsed((current) => !current)}
            >
              {contentCollapsed ? 'Mostrar carteira' : 'Ocultar carteira'}
              <ChevronDown className={`h-4 w-4 transition-transform ${contentCollapsed ? '' : 'rotate-180'}`} />
            </Button>
          )}
          {showOwnerToolbar && !contentCollapsed && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select value={viewMode} onValueChange={onViewModeChange}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Visualização" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">
                    <div className="flex items-center gap-2">
                      <Rows3 className="h-4 w-4" />
                      Lista vertical
                    </div>
                  </SelectItem>
                  <SelectItem value="cards">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4" />
                      Cards completos
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              {!isViewerMode && canViewGlobal && semResponsavel > 0 && (
                <button
                  type="button"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
                  onClick={onFilterUnassigned}
                >
                  Sem responsável: {formatNumber(semResponsavel)}
                </button>
              )}
              {!isViewerMode && canViewGlobal && (
                <Button type="button" variant="outline" size="sm" onClick={onFilterAll}>
                  Todos
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {!contentCollapsed && (
        <div id="orders-owner-cards-content">
          {viewMode === 'list' ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {visibleOwners.map((owner) => {
            const ownerKey = toOrderOwnerKey(owner.administrador_id)
            const active = isPrivateScope ? false : activeResponsavel === ownerKey
            const ownerCargo = resolveCargoPresentationFromOwner({
              administrador_id: owner.administrador_id,
              nome: owner.nome,
              especialidade: owner.administrador_id ? (ownerEspecialidadeById.get(owner.administrador_id) ?? null) : null,
            })

            return (
              <CollaboratorCardShell
                key={ownerKey}
                variant="operational"
                name={owner.nome}
                avatarUrl={owner.avatar_url}
                cargo={ownerCargo}
                active={active}
                onClick={() => onToggleOwner(ownerKey)}
                secondaryMetrics={[
                  { id: 'recentes', label: '0-2d', value: formatNumber(owner.recentes), tone: 'success', icon: TimerReset },
                  { id: 'atencao', label: '3-6d', value: formatNumber(owner.atencao), tone: 'warning', icon: Clock3 },
                  { id: 'atrasadas', label: '7+d', value: formatNumber(owner.atrasadas), tone: 'danger', icon: AlertTriangle },
                ]}
                summary={
                  <>
                    <span className="text-base font-bold text-foreground">{formatNumber(owner.total)}</span>
                    <span> de ordens ativas</span>
                  </>
                }
              />
            )
          })}
            </div>
          ) : (
            <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {ownerGroups.map((group) => (
              <OrdersOwnerFullCard
                key={group.id}
                group={group}
                canReassign={canReassign}
                reassignTargets={reassignTargets}
                selectedNotaIds={selectedNotaIds}
                onToggleRowSelection={onToggleSelection}
              />
            ))}
            {poolGroupsWithRows.map((group) => (
              <OrdersPoolCard key={group.pool_nome} group={group} />
            ))}
          </div>
          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Carregando...</>
                ) : (
                  `Carregar mais (${rowsCount} carregadas)`
                )}
              </Button>
            </div>
          )}
            </>
          )}
        </div>
      )}
    </div>
  )
})
