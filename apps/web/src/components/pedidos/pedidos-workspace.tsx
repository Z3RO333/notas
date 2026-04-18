'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PedidosKpiStrip } from '@/components/pedidos/pedidos-kpi-strip'
import { PedidoRow } from '@/components/pedidos/pedido-row'
import { PedidoDetailDrawer } from '@/components/pedidos/pedido-detail-drawer'
import { usePedidosFilters } from '@/components/pedidos/use-pedidos-filters'
import { usePedidosData } from '@/components/pedidos/use-pedidos-data'
import type { PedidoCompra, PedidosWorkspaceFilters } from '@/lib/types/pedidos'
import type { UserRole } from '@/lib/types/database'

interface PedidosWorkspaceProps {
  initialFilters: PedidosWorkspaceFilters
  initialUser: {
    role: UserRole
    adminId: string
    canViewGlobal: boolean
  }
}

export function PedidosWorkspace({ initialFilters, initialUser }: PedidosWorkspaceProps) {
  const { filters, setFilters, searchInput, setSearchInput, searchInputRef } = usePedidosFilters({ initialFilters })
  const {
    rows,
    kpis,
    availableAdmins,
    availableAnos,
    availableMeses,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    loadingInitial,
    error,
  } = usePedidosData({ filters })
  const [selectedPedido, setSelectedPedido] = useState<PedidoCompra | null>(null)

  const parentRef = useRef<HTMLDivElement | null>(null)

  const adminMap = Object.fromEntries(availableAdmins.map((a) => [a.id, a.nome]))

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 80, []),
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 })
  }, [filters.q, filters.status, filters.adminId, filters.anoExtracao, filters.mesExtracao])

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1]
    if (!lastItem) return
    if (!hasNextPage || isFetchingNextPage || loadingInitial) return
    if (lastItem.index < rows.length - 15) return
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loadingInitial, rows.length, virtualItems])

  return (
    <div className="space-y-4">
      <PedidosKpiStrip kpis={kpis} loading={loadingInitial} />

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por fornecedor, codigo ou pedido... (/)"
            className="pl-8 pr-8"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setFilters((prev) => ({ ...prev, q: '' })) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select
          value={filters.status}
          onValueChange={(val) => setFilters((prev) => ({ ...prev, status: val as PedidosWorkspaceFilters['status'] }))}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="em_aberto">Em aberto</SelectItem>
            <SelectItem value="encerrado">Encerrado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>

        {availableAnos.length > 0 && (
          <Select
            value={filters.anoExtracao ?? 'all'}
            onValueChange={(val) => setFilters((prev) => ({
              ...prev,
              anoExtracao: val === 'all' ? null : val,
              mesExtracao:
                prev.mesExtracao && val !== 'all' && !prev.mesExtracao.startsWith(val)
                  ? null
                  : prev.mesExtracao,
            }))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os anos</SelectItem>
              {availableAnos.map((ano) => (
                <SelectItem key={ano} value={ano}>
                  {ano}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {availableMeses.length > 0 && (
          <Select
            value={filters.mesExtracao ?? 'all'}
            onValueChange={(val) => setFilters((prev) => ({ ...prev, mesExtracao: val === 'all' ? null : val }))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {availableMeses.map((mes) => (
                <SelectItem key={mes} value={mes}>
                  {mes.slice(4, 6)}/{mes.slice(0, 4)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {initialUser.canViewGlobal && availableAdmins.length > 0 && (
          <Select
            value={filters.adminId}
            onValueChange={(val) => setFilters((prev) => ({ ...prev, adminId: val }))}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Administrador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {availableAdmins.map((admin) => (
                <SelectItem key={admin.id} value={admin.id}>{admin.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {isFetching && !loadingInitial
          ? (isFetchingNextPage ? `Carregando mais... ${rows.length} pedido${rows.length !== 1 ? 's' : ''}` : 'Atualizando...')
          : `${rows.length} pedido${rows.length !== 1 ? 's' : ''}${hasNextPage ? ' carregados' : ''}`}
      </p>

      {/* Virtual list */}
      {loadingInitial ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          Nenhum pedido encontrado.
        </div>
      ) : (
        <div className="space-y-3">
          <div
            ref={parentRef}
            className="h-[600px] overflow-y-auto"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((vItem) => {
                const pedido = rows[vItem.index]
                return (
                  <div
                    key={vItem.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vItem.start}px)`,
                      paddingBottom: '8px',
                    }}
                    ref={virtualizer.measureElement}
                    data-index={vItem.index}
                  >
                    <PedidoRow
                      pedido={pedido}
                      onOpen={setSelectedPedido}
                      adminNome={initialUser.canViewGlobal ? adminMap[pedido.administrador_id] : undefined}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {isFetchingNextPage
              ? 'Carregando mais pedidos...'
              : hasNextPage
                ? 'Role para carregar mais pedidos.'
                : `${rows.length} pedido${rows.length !== 1 ? 's' : ''} carregado${rows.length !== 1 ? 's' : ''}.`}
          </div>
        </div>
      )}

      <PedidoDetailDrawer
        open={selectedPedido !== null}
        onOpenChange={(next) => { if (!next) setSelectedPedido(null) }}
        pedido={selectedPedido}
        adminNome={selectedPedido ? adminMap[selectedPedido.administrador_id] : undefined}
      />
    </div>
  )
}
