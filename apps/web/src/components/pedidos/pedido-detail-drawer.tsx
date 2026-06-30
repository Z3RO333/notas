'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DrawerDetalhes } from '@/components/shared/drawer-detalhes'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import type { PedidoCompra, PedidoCompraItem, PedidoCompraStatus } from '@/lib/types/pedidos'
import styles from './pedido-detail-drawer.module.css'

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

const STATUS_VARIANT: Record<PedidoCompraStatus, 'warning' | 'success' | 'destructive'> = {
  em_aberto: 'warning',
  encerrado: 'success',
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

function resolveFornecedorPrincipal(pedido: PedidoCompra): string {
  return pedido.fornecedor_nome ?? pedido.fornecedor_codigo ?? pedido.fornecedor ?? 'Fornecedor sem nome'
}

function resolveFornecedorCodigo(pedido: PedidoCompra): string | null {
  if (pedido.fornecedor_nome) {
    return pedido.fornecedor_codigo ?? pedido.fornecedor ?? null
  }
  return null
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || '-'}</span>
    </div>
  )
}

function DrawerHero({ pedido }: { pedido: PedidoCompra }) {
  const fornecedorPrincipal = resolveFornecedorPrincipal(pedido)
  const fornecedorCodigo = resolveFornecedorCodigo(pedido)

  return (
    <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-sky-500/10 via-background to-amber-500/10 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/80">
            Painel do pedido
          </p>
          <div className="space-y-1">
            <p className="truncate text-base font-semibold text-foreground">
              {fornecedorPrincipal}
            </p>
            <p className="text-xs text-muted-foreground">
              Pedido {pedido.documento_compras}
              {fornecedorCodigo ? ` | cod. ${fornecedorCodigo}` : ''}
              {pedido.tipo_documento ? ` | ${pedido.tipo_documento}` : ''}
            </p>
          </div>
        </div>

        <div className={styles.scene} aria-hidden="true">
          <svg
            viewBox="0 0 12 16"
            xmlns="http://www.w3.org/2000/svg"
            shapeRendering="crispEdges"
            className={styles.mario}
          >
            <rect x="3" y="0" width="5" height="1" fill="#E52521" />
            <rect x="2" y="1" width="9" height="1" fill="#E52521" />
            <rect x="2" y="2" width="3" height="1" fill="#432817" />
            <rect x="5" y="2" width="2" height="1" fill="#FADCB2" />
            <rect x="7" y="2" width="1" height="1" fill="#000000" />
            <rect x="8" y="2" width="1" height="1" fill="#FADCB2" />
            <rect x="1" y="3" width="1" height="1" fill="#432817" />
            <rect x="2" y="3" width="1" height="1" fill="#FADCB2" />
            <rect x="3" y="3" width="1" height="1" fill="#432817" />
            <rect x="4" y="3" width="3" height="1" fill="#FADCB2" />
            <rect x="7" y="3" width="1" height="1" fill="#000000" />
            <rect x="8" y="3" width="3" height="1" fill="#FADCB2" />
            <rect x="1" y="4" width="1" height="1" fill="#432817" />
            <rect x="2" y="4" width="1" height="1" fill="#FADCB2" />
            <rect x="3" y="4" width="2" height="1" fill="#432817" />
            <rect x="5" y="4" width="3" height="1" fill="#FADCB2" />
            <rect x="8" y="4" width="1" height="1" fill="#000000" />
            <rect x="9" y="4" width="3" height="1" fill="#FADCB2" />
            <rect x="1" y="5" width="2" height="1" fill="#432817" />
            <rect x="3" y="5" width="4" height="1" fill="#FADCB2" />
            <rect x="7" y="5" width="4" height="1" fill="#000000" />
            <rect x="3" y="6" width="7" height="1" fill="#FADCB2" />
            <rect x="2" y="7" width="2" height="1" fill="#E52521" />
            <rect x="4" y="7" width="1" height="1" fill="#0043A6" />
            <rect x="5" y="7" width="3" height="1" fill="#E52521" />
            <rect x="1" y="8" width="3" height="1" fill="#E52521" />
            <rect x="4" y="8" width="1" height="1" fill="#0043A6" />
            <rect x="5" y="8" width="2" height="1" fill="#E52521" />
            <rect x="7" y="8" width="1" height="1" fill="#0043A6" />
            <rect x="8" y="8" width="3" height="1" fill="#E52521" />
            <rect x="0" y="9" width="4" height="1" fill="#E52521" />
            <rect x="4" y="9" width="4" height="1" fill="#0043A6" />
            <rect x="8" y="9" width="4" height="1" fill="#E52521" />
            <rect x="0" y="10" width="2" height="1" fill="#FADCB2" />
            <rect x="2" y="10" width="1" height="1" fill="#E52521" />
            <rect x="3" y="10" width="1" height="1" fill="#FBD000" />
            <rect x="4" y="10" width="4" height="1" fill="#0043A6" />
            <rect x="8" y="10" width="1" height="1" fill="#FBD000" />
            <rect x="9" y="10" width="1" height="1" fill="#E52521" />
            <rect x="10" y="10" width="2" height="1" fill="#FADCB2" />
            <rect x="0" y="11" width="3" height="1" fill="#FADCB2" />
            <rect x="3" y="11" width="6" height="1" fill="#0043A6" />
            <rect x="9" y="11" width="3" height="1" fill="#FADCB2" />
            <rect x="0" y="12" width="2" height="1" fill="#FADCB2" />
            <rect x="2" y="12" width="8" height="1" fill="#0043A6" />
            <rect x="10" y="12" width="2" height="1" fill="#FADCB2" />
            <rect x="2" y="13" width="3" height="1" fill="#0043A6" />
            <rect x="7" y="13" width="3" height="1" fill="#0043A6" />
            <rect x="1" y="14" width="3" height="1" fill="#432817" />
            <rect x="8" y="14" width="3" height="1" fill="#432817" />
            <rect x="0" y="15" width="4" height="1" fill="#432817" />
            <rect x="8" y="15" width="4" height="1" fill="#432817" />
          </svg>

          <div className={styles.coinContainer}>
            <div className={styles.coin} />
          </div>
        </div>
      </div>
    </section>
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
        if (err) {
          setError(err.message)
        } else {
          setItems((data ?? []) as PedidoCompraItem[])
        }
        setLoading(false)
      })
  }, [open, pedido])

  if (!pedido) return null

  const fornecedorPrincipal = resolveFornecedorPrincipal(pedido)
  const fornecedorCodigo = resolveFornecedorCodigo(pedido)

  return (
    <DrawerDetalhes
      open={open}
      onOpenChange={onOpenChange}
      title={`Pedido ${pedido.documento_compras}`}
      subtitle={pedido.tipo_documento ?? undefined}
    >
      <div className="space-y-6">
        <DrawerHero pedido={pedido} />

        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[pedido.status]}>{STATUS_LABEL[pedido.status]}</Badge>
          {pedido.tipo_documento && (
            <span className="text-xs text-muted-foreground">{pedido.tipo_documento}</span>
          )}
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dados gerais
          </h3>
          <div className="divide-y rounded-lg border px-3">
            <InfoRow label="Documento" value={pedido.documento_compras} />
            <InfoRow label="Fornecedor" value={fornecedorPrincipal} />
            {fornecedorCodigo && <InfoRow label="Codigo fornecedor" value={fornecedorCodigo} />}
            <InfoRow label="Data documento" value={fmtDate(pedido.data_documento)} />
            <InfoRow label="Mes extracao" value={fmtMes(pedido.mes_extracao)} />
            <InfoRow label="SAP codigo" value={pedido.sap_codigo} />
            {adminNome && <InfoRow label="Administrador" value={adminNome} />}
            <InfoRow label="Valor total" value={fmtCurrency(pedido.valor_liquido_total)} />
          </div>
        </section>

        {pedido.nf_referencias.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notas fiscais ({pedido.nf_referencias.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {pedido.nf_referencias.map((nf) => (
                <span
                  key={nf}
                  className="inline-flex items-center rounded-md border bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                >
                  {nf}
                </span>
              ))}
            </div>
          </section>
        )}

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
                <div key={item.id} className="space-y-1 rounded-lg border px-3 py-2 text-sm">
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
                      <span>Preco unit.: {fmtCurrency(item.preco_unitario)}</span>
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
