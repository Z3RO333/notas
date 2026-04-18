'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DrawerDetalhes } from '@/components/shared/drawer-detalhes'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import type { PedidoCompra, PedidoCompraItem, PedidoCompraStatus } from '@/lib/types/pedidos'

interface PedidoDetailDrawerProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  pedido: PedidoCompra | null
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
  return `${value.slice(4, 6)}/${value.slice(0, 4)}`
}

function fmtQty(value: number | null, unit: string | null): string {
  if (value === null) return '-'
  const qty = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)
  return unit ? `${qty} ${unit}` : qty
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || '-'}</span>
    </div>
  )
}

export function PedidoDetailDrawer({ open, onOpenChange, pedido, adminNome }: PedidoDetailDrawerProps) {
  const [items, setItems] = useState<PedidoCompraItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !pedido) {
      setItems([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    void supabase
      .from('pedidos_compra_itens')
      .select('*')
      .eq('documento_compras', pedido.documento_compras)
      .order('item_numero')
      .then(({ data, error: err }) => {
        if (err) { setError(err.message) } else { setItems((data ?? []) as PedidoCompraItem[]) }
        setLoading(false)
      })
  }, [open, pedido])

  if (!pedido) return null

  return (
    <DrawerDetalhes
      open={open}
      onOpenChange={onOpenChange}
      title={`Pedido ${pedido.documento_compras}`}
      subtitle={pedido.tipo_documento ?? undefined}
    >
      <div className="space-y-6">
        {/* Header info */}
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[pedido.status]}>{STATUS_LABEL[pedido.status]}</Badge>
          {pedido.tipo_documento && (
            <span className="text-xs text-muted-foreground">{pedido.tipo_documento}</span>
          )}
        </div>

        {/* Dados gerais */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dados gerais
          </h3>
          <div className="divide-y rounded-lg border px-3">
            <InfoRow label="Documento" value={pedido.documento_compras} />
            <InfoRow label="Fornecedor" value={pedido.fornecedor ?? '-'} />
            <InfoRow label="Data documento" value={fmtDate(pedido.data_documento)} />
            <InfoRow label="Mês extração" value={fmtMes(pedido.mes_extracao)} />
            <InfoRow label="SAP código" value={pedido.sap_codigo} />
            {adminNome && <InfoRow label="Administrador" value={adminNome} />}
            <InfoRow label="Valor total" value={fmtCurrency(pedido.valor_liquido_total)} />
          </div>
        </section>

        {/* Itens */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Itens do pedido
          </h3>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando itens...
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
          )}
          {!loading && items.length > 0 && (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border px-3 py-2 text-sm space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">Item {item.item_numero}</span>
                    <span className="font-semibold">{fmtCurrency(item.valor_liquido)}</span>
                  </div>
                  {item.descricao && <p className="font-medium">{item.descricao}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {item.codigo_material && <span>Material: {item.codigo_material}</span>}
                    {item.grupo_mercadoria && <span>Grupo: {item.grupo_mercadoria}</span>}
                    {item.centro && <span>Centro: {item.centro}</span>}
                    {item.quantidade !== null && (
                      <span>Qtd: {fmtQty(item.quantidade, item.unidade_medida)}</span>
                    )}
                    {item.preco_unitario !== null && (
                      <span>Preço unit.: {fmtCurrency(item.preco_unitario)}</span>
                    )}
                    {item.requisicao_compra && <span>RC: {item.requisicao_compra}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DrawerDetalhes>
  )
}
