'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Building2, Loader2, PackageCheck, UserRound } from 'lucide-react'
import { DrawerDetalhes } from '@/components/shared/drawer-detalhes'
import { Badge } from '@/components/ui/badge'
import { buscarItensPedido } from '@/lib/actions/pedido-itens-actions'
import type { PedidoCompra, PedidoCompraItem, PedidoCompraStatusEfetivo } from '@/lib/types/pedidos'

interface PedidoDetailDrawerProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  pedido: PedidoCompra | null
  adminNome?: string
}

const STATUS_LABEL: Record<PedidoCompraStatusEfetivo, string> = {
  em_aberto: 'Em aberto', encerrado: 'Encerrado', cancelado: 'Cancelado', indeterminado: 'Status a revisar',
}
const STATUS_VARIANT: Record<PedidoCompraStatusEfetivo, 'warning' | 'success' | 'destructive' | 'outline'> = {
  em_aberto: 'warning', encerrado: 'success', cancelado: 'destructive', indeterminado: 'outline',
}

function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function fmtDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return '—'
  const date = new Date(includeTime ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', includeTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date)
}

function fmtQty(value: number | null, unit: string | null): string {
  if (value === null) return '—'
  const qty = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)
  return unit ? `${qty} ${unit}` : qty
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words text-right font-medium">{value || '—'}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function PedidoDetailDrawer({ open, onOpenChange, pedido, adminNome }: PedidoDetailDrawerProps) {
  const [items, setItems] = useState<PedidoCompraItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !pedido) { setItems([]); setError(null); return }
    let active = true
    setLoading(true)
    setError(null)
    buscarItensPedido(pedido.documento_compras)
      .then((data) => { if (active) setItems(data) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Erro ao carregar itens') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, pedido])

  if (!pedido) return null
  const status = pedido.status_efetivo ?? pedido.status
  const fornecedor = pedido.fornecedor_nome ?? pedido.fornecedor_codigo ?? pedido.fornecedor ?? 'Fornecedor não identificado'
  const fornecedorCodigo = pedido.fornecedor_codigo ?? pedido.fornecedor
  const responsavel = pedido.responsavel_atual_nome ?? adminNome ?? 'Sem responsável'
  const valorAtivo = pedido.valor_itens_ativos ?? pedido.valor_liquido_total

  return (
    <DrawerDetalhes open={open} onOpenChange={onOpenChange} title={`Pedido ${pedido.documento_compras}`} subtitle={`${fornecedor} · grupo de compradores ${pedido.grupo_compradores ?? '112'}`}>
      <div className="space-y-6">
        <section className="rounded-xl border border-border/70 bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
            <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" /> Grupo {pedido.grupo_compradores ?? '112'}</Badge>
            {pedido.tipo_documento && <Badge variant="outline">{pedido.tipo_documento}</Badge>}
          </div>
          <p className="mt-3 text-base font-semibold">{fornecedor}</p>
          {fornecedorCodigo && <p className="text-xs text-muted-foreground">Código {fornecedorCodigo}</p>}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-background/70 p-3">
              <p className="text-[11px] text-muted-foreground">Valor dos itens ativos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{fmtCurrency(valorAtivo)}</p>
            </div>
            <div className="rounded-lg border bg-background/70 p-3">
              <p className="text-[11px] text-muted-foreground">Itens ativos</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{pedido.itens_ativos ?? '—'}{pedido.itens_total !== undefined ? ` / ${pedido.itens_total}` : ''}</p>
            </div>
          </div>
        </section>

        <Section title="Responsabilidade">
          <div className="divide-y rounded-lg border px-3">
            <InfoRow label="Responsável atual" value={responsavel} />
            <InfoRow label="Criador no SAP" value={pedido.criador_admin_nome ?? pedido.sap_codigo ?? '—'} />
            <InfoRow label="Dono da carteira" value={pedido.fornecedor_owner_nome ?? 'Sem carteira especial'} />
          </div>
          {!pedido.responsavel_atual_id && (
            <div className="flex gap-2 rounded-lg border border-red-300 bg-red-50/70 p-3 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-300">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0" /> Este pedido ainda não possui responsável operacional.
            </div>
          )}
        </Section>

        <Section title="Documento e rastreabilidade">
          <div className="divide-y rounded-lg border px-3">
            <InfoRow label="Data do documento" value={fmtDate(pedido.data_documento)} />
            <InfoRow label="Data de criação" value={fmtDate(pedido.data_criacao)} />
            <InfoRow label="Organização de compras" value={pedido.organizacao_compras ?? '—'} />
            <InfoRow label="Status bruto" value={pedido.status_proc_raw ?? pedido.status_header ?? '—'} />
            <InfoRow label="Última presença na fonte" value={fmtDate(pedido.source_last_seen_at, true)} />
          </div>
        </Section>

        {(pedido.status_indeterminado || Boolean(pedido.valor_divergencia) || (pedido.items_quality && pedido.items_quality !== 'ok')) && (
          <Section title="Qualidade dos dados">
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Validação recomendada</p>
              {pedido.status_indeterminado && <p>Status efetivo não pôde ser determinado com segurança.</p>}
              {pedido.valor_divergencia !== null && pedido.valor_divergencia !== undefined && pedido.valor_divergencia !== 0 && <p>Divergência entre cabeçalho e itens: {fmtCurrency(pedido.valor_divergencia)}.</p>}
              {pedido.items_quality && pedido.items_quality !== 'ok' && <p>Qualidade dos itens: {pedido.items_quality}.</p>}
            </div>
          </Section>
        )}

        {pedido.nf_referencias.length > 0 && (
          <Section title={`Notas fiscais (${pedido.nf_referencias.length})`}>
            <div className="flex flex-wrap gap-1.5">{pedido.nf_referencias.map((nf) => <span key={nf} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">{nf}</span>)}</div>
          </Section>
        )}

        <Section title="Itens do pedido">
          {loading && <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando itens…</div>}
          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
          {!loading && !error && items.length === 0 && <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhum item encontrado.</div>}
          {!loading && items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => {
                const excluido = Boolean(item.excluido)
                return (
                  <article key={item.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">Item {item.item_numero}</span>
                          {item.centro && <Badge variant="outline">Centro {item.centro}</Badge>}
                          {excluido && <Badge variant="destructive">Excluído</Badge>}
                        </div>
                        <p className="mt-1 font-medium">{item.descricao ?? 'Item sem descrição'}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">{fmtCurrency(item.valor_liquido)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><PackageCheck className="h-3.5 w-3.5" /> {fmtQty(item.quantidade, item.unidade_medida)}</span>
                      {item.preco_unitario !== null && <span>Preço unitário: {fmtCurrency(item.preco_unitario)}</span>}
                      {item.requisicao_compra && <span>RC: {item.requisicao_compra}</span>}
                      {item.codigo_material && <span>Material: {item.codigo_material}</span>}
                      {item.grupo_mercadoria && <span>Grupo mercadoria: {item.grupo_mercadoria}</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </Section>
      </div>
    </DrawerDetalhes>
  )
}
