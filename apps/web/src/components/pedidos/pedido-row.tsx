'use client'

import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import type { PedidoCompra, PedidoCompraStatus } from '@/lib/types/pedidos'

interface PedidoRowProps {
  pedido: PedidoCompra
  onOpen: (pedido: PedidoCompra) => void
  adminNome?: string
}

const STATUS_LABEL: Record<PedidoCompraStatus, string> = {
  em_aberto: 'Em aberto',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
}

const STATUS_VARIANT: Record<PedidoCompraStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  em_aberto: 'default',
  encerrado: 'secondary',
  cancelado: 'destructive',
}

function fmtCurrency(value: number | null): string {
  if (value === null) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function fmtDate(value: string | null): string {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function fmtMes(value: string): string {
  if (value.length !== 6) return value
  const year = value.slice(0, 4)
  const month = value.slice(4, 6)
  return `${month}/${year}`
}

function getFornecedorPrincipal(pedido: PedidoCompra): string | null {
  return pedido.fornecedor_nome ?? pedido.fornecedor_codigo ?? pedido.fornecedor ?? null
}

function getFornecedorSecundario(pedido: PedidoCompra): string | null {
  if (pedido.fornecedor_nome) {
    return pedido.fornecedor_codigo ?? pedido.fornecedor ?? null
  }
  return null
}

export const PedidoRow = memo(function PedidoRow({ pedido, onOpen, adminNome }: PedidoRowProps) {
  const fornecedorPrincipal = getFornecedorPrincipal(pedido)
  const fornecedorSecundario = getFornecedorSecundario(pedido)

  return (
    <button
      type="button"
      onClick={() => onOpen(pedido)}
      className="w-full text-left rounded-lg border bg-card px-4 py-3 shadow-sm transition-all hover:shadow-md hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{pedido.documento_compras}</span>
            <Badge variant={STATUS_VARIANT[pedido.status]}>{STATUS_LABEL[pedido.status]}</Badge>
            {pedido.tipo_documento && (
              <span className="text-xs text-muted-foreground">{pedido.tipo_documento}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {fornecedorPrincipal && (
              <span>
                Fornecedor:{' '}
                <span className="font-medium text-foreground">{fornecedorPrincipal}</span>
                {fornecedorSecundario && (
                  <span className="text-muted-foreground"> ({fornecedorSecundario})</span>
                )}
              </span>
            )}
            {pedido.data_documento && (
              <span>Data: <span className="font-medium text-foreground">{fmtDate(pedido.data_documento)}</span></span>
            )}
            <span>Ref: <span className="font-medium text-foreground">{fmtMes(pedido.mes_extracao)}</span></span>
            {adminNome && (
              <span>Admin: <span className="font-medium text-foreground">{adminNome}</span></span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{fmtCurrency(pedido.valor_liquido_total)}</p>
        </div>
      </div>
    </button>
  )
})
