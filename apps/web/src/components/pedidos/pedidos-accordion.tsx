'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PedidoRow } from '@/components/pedidos/pedido-row'
import { PedidoDetailDrawer } from '@/components/pedidos/pedido-detail-drawer'
import { usePedidosData } from '@/components/pedidos/use-pedidos-data'
import type { PedidoCompra, PedidoCompraStatus, PedidosWorkspaceFilters } from '@/lib/types/pedidos'

interface PedidosAccordionProps {
  adminId: string
  isOpen: boolean
}

export function PedidosAccordion({ adminId, isOpen }: PedidosAccordionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [status, setStatus] = useState<PedidoCompraStatus | 'all'>('all')
  const [anoExtracao, setAnoExtracao] = useState<string | null>(null)
  const [mesExtracao, setMesExtracao] = useState<string | null>(null)
  const [selectedPedido, setSelectedPedido] = useState<PedidoCompra | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const filters: PedidosWorkspaceFilters = {
    q,
    status,
    adminId,
    anoExtracao,
    mesExtracao,
  }

  const {
    rows,
    availableAnos,
    availableMeses,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    loadingInitial,
    error,
  } = usePedidosData({ filters })

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [q, status, anoExtracao, mesExtracao])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div ref={ref} className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar fornecedor ou pedido..."
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setQ('') }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select
          value={status}
          onValueChange={(val) => setStatus(val as PedidoCompraStatus | 'all')}
        >
          <SelectTrigger className="w-[130px] h-8 text-sm">
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
            value={anoExtracao ?? 'all'}
            onValueChange={(val) => {
              setAnoExtracao(val === 'all' ? null : val)
              setMesExtracao(null)
            }}
          >
            <SelectTrigger className="w-[100px] h-8 text-sm">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os anos</SelectItem>
              {availableAnos.map((ano) => (
                <SelectItem key={ano} value={ano}>{ano}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {availableMeses.length > 0 && (
          <Select
            value={mesExtracao ?? 'all'}
            onValueChange={(val) => setMesExtracao(val === 'all' ? null : val)}
          >
            <SelectTrigger className="w-[110px] h-8 text-sm">
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
      </div>

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
