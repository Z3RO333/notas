'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PedidoRow } from '@/components/pedidos/pedido-row'
import { PedidoDetailDrawer } from '@/components/pedidos/pedido-detail-drawer'
import { usePedidosData } from '@/components/pedidos/use-pedidos-data'
import type { PedidoCompra, PedidosWorkspaceFilters } from '@/lib/types/pedidos'

export type PedidosGlobalFilters = Omit<PedidosWorkspaceFilters, 'adminId'>

interface PedidosAccordionProps {
  adminId: string
  isOpen: boolean
  filters: PedidosGlobalFilters
}

export function PedidosAccordion({ adminId, isOpen, filters }: PedidosAccordionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [selectedPedido, setSelectedPedido] = useState<PedidoCompra | null>(null)

  const fullFilters: PedidosWorkspaceFilters = { ...filters, adminId }

  const {
    rows,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    loadingInitial,
    error,
  } = usePedidosData({ filters: fullFilters })

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [filters.q, filters.status, filters.anoExtracao, filters.mesExtracao])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div ref={ref} className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-4">
      {!loadingInitial && (
        <p className="text-xs text-muted-foreground">
          {isFetching && !isFetchingNextPage
            ? 'Atualizando...'
            : `${rows.length} pedido${rows.length !== 1 ? 's' : ''}${hasNextPage ? ' carregados' : ''}`}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loadingInitial ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Nenhum pedido encontrado.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((pedido) => (
            <PedidoRow
              key={pedido.id}
              pedido={pedido}
              onOpen={setSelectedPedido}
            />
          ))}

          {hasNextPage && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </div>
      )}

      <PedidoDetailDrawer
        open={selectedPedido !== null}
        onOpenChange={(next) => { if (!next) setSelectedPedido(null) }}
        pedido={selectedPedido}
      />
    </div>
  )
}
