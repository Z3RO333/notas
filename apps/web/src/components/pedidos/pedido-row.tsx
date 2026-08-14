'use client'

import { memo } from 'react'
import { AlertTriangle, Building2, CalendarDays, FileText, PackageCheck, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import type { PedidoCompra, PedidoCompraStatusEfetivo } from '@/lib/types/pedidos'

interface PedidoRowProps {
  pedido: PedidoCompra
  onOpen: (pedido: PedidoCompra) => void
  adminNome?: string
  adminAvatarUrl?: string | null
}

const STATUS_LABEL: Record<PedidoCompraStatusEfetivo, string> = {
  em_aberto: 'Em aberto',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
  indeterminado: 'A revisar',
}

const STATUS_VARIANT: Record<PedidoCompraStatusEfetivo, 'warning' | 'success' | 'destructive' | 'outline'> = {
  em_aberto: 'warning',
  encerrado: 'success',
  cancelado: 'destructive',
  indeterminado: 'outline',
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

function getFornecedorPrincipal(pedido: PedidoCompra): string | null {
  return pedido.fornecedor_nome ?? pedido.fornecedor_codigo ?? pedido.fornecedor ?? null
}

function getFornecedorSecundario(pedido: PedidoCompra): string | null {
  if (pedido.fornecedor_nome) {
    return pedido.fornecedor_codigo ?? pedido.fornecedor ?? null
  }
  return null
}

export const PedidoRow = memo(function PedidoRow({ pedido, onOpen, adminNome, adminAvatarUrl }: PedidoRowProps) {
  const fornecedorPrincipal = getFornecedorPrincipal(pedido)
  const fornecedorSecundario = getFornecedorSecundario(pedido)
  const status = pedido.status_efetivo ?? pedido.status
  const responsavelNome = pedido.responsavel_atual_nome ?? adminNome ?? null
  const valorOperacional = pedido.valor_itens_ativos ?? pedido.valor_liquido_total

  return (
    <button
      type="button"
      onClick={() => onOpen(pedido)}
      className="group w-full rounded-xl border border-border/70 bg-card px-4 py-3 text-left shadow-sm transition-all hover:border-primary/35 hover:bg-muted/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {responsavelNome && (
          <div className="shrink-0">
            <Avatar src={adminAvatarUrl} nome={responsavelNome} size="sm" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{pedido.documento_compras}</span>
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
            <Badge variant="outline" className="gap-1 font-normal">
              <Building2 className="h-3 w-3" /> Grupo {pedido.grupo_compradores ?? '112'}
            </Badge>
            {pedido.na_carteira_especial && pedido.fornecedor_owner_nome && (
              <Badge variant="outline">Dono da carteira: {pedido.fornecedor_owner_nome}</Badge>
            )}
            {pedido.tipo_documento && (
              <span className="text-xs text-muted-foreground">{pedido.tipo_documento}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {fornecedorPrincipal && (
              <span className="inline-flex items-center gap-1">
                <PackageCheck className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{fornecedorPrincipal}</span>
                {fornecedorSecundario && (
                  <span className="text-muted-foreground"> ({fornecedorSecundario})</span>
                )}
              </span>
            )}
            {pedido.data_documento && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{fmtDate(pedido.data_documento)}</span>
              </span>
            )}
            {pedido.nf_referencias.length > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                <FileText className="h-3.5 w-3.5" />
                NF: {pedido.nf_referencias.length === 1
                  ? pedido.nf_referencias[0]
                  : `${pedido.nf_referencias.length} NFs`}
              </span>
            )}
            {responsavelNome ? (
              <span className="inline-flex items-center gap-1">
                <UserRound className="h-3.5 w-3.5" />
                Responsável: <span className="font-medium text-foreground">{responsavelNome}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Sem responsável
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 border-t border-border/60 pt-2 text-left lg:border-0 lg:pt-0 lg:text-right">
          <p className="text-[11px] text-muted-foreground">Valor dos itens ativos</p>
          <p className="text-sm font-semibold tabular-nums">{fmtCurrency(valorOperacional)}</p>
          {pedido.itens_ativos !== undefined && (
            <p className="text-[11px] text-muted-foreground">
              {pedido.itens_ativos} de {pedido.itens_total ?? pedido.itens_ativos} itens ativos
            </p>
          )}
        </div>
      </div>
    </button>
  )
})
