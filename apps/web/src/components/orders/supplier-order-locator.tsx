'use client'

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Copy, ExternalLink, Loader2, Search } from 'lucide-react'
import { DrawerDetalhes } from '@/components/shared/drawer-detalhes'
import { OrdersDetailDrawer } from '@/components/orders/orders-detail-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { copyToClipboard } from '@/lib/orders/copy'
import { getRawStatusClass, getRawStatusLabel } from '@/lib/orders/metrics'
import type {
  FornecedorOrderSearchRow,
  OrderReassignTarget,
} from '@/lib/types/database'

interface SupplierOrderLocatorProps {
  currentAdminId: string
  canReassign: boolean
  reassignTargets: OrderReassignTarget[]
  onReassigned?: (payload: { notaId: string; novoAdminId: string }) => void
}

interface SupplierSearchResponse {
  rows: FornecedorOrderSearchRow[]
  q: string
  limit: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('pt-BR')
}

function normalizeNoteId(value: string | null | undefined): string | null {
  const text = (value ?? '').trim()
  return text.length > 0 ? text : null
}

function getSupplierLabel(row: FornecedorOrderSearchRow): string {
  const code = row.fornecedor_codigo?.trim()
  const name = row.fornecedor_nome?.trim()
  if (code && name && code !== name) return `${code} - ${name}`
  return name ?? code ?? 'Fornecedor não identificado'
}

export function SupplierOrderLocator({
  currentAdminId,
  canReassign,
  reassignTargets,
  onReassigned,
}: SupplierOrderLocatorProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [rows, setRows] = useState<FornecedorOrderSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<FornecedorOrderSearchRow | null>(null)

  const supplierHeading = useMemo(() => {
    if (rows.length === 0) return null
    return getSupplierLabel(rows[0])
  }, [rows])

  async function handleSearch(event?: FormEvent) {
    event?.preventDefault()
    const clean = query.trim()
    if (clean.replace(/[%_\s\\]+/g, '').length < 3) {
      setError('Informe pelo menos 3 caracteres.')
      setRows([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q: clean, limit: '50' })
      const response = await fetch(`/api/ordens/fornecedor-search?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => ({}))) as Partial<SupplierSearchResponse> & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Falha ao localizar fornecedor')
      }
      setRows(payload.rows ?? [])
      setLastQuery(payload.q ?? clean)
    } catch (searchError) {
      setRows([])
      setError(searchError instanceof Error ? searchError.message : 'Falha ao localizar fornecedor')
    } finally {
      setLoading(false)
    }
  }

  async function copyOrder(row: FornecedorOrderSearchRow, label: string) {
    const value = row.ordem_codigo?.trim()
    if (!value) {
      toast({ title: 'Ordem sem código copiável', variant: 'info' })
      return
    }
    const copied = await copyToClipboard(value)
    toast({
      title: copied ? `${label} ${value} copiada` : `Falha ao copiar ${label}`,
      variant: copied ? 'success' : 'error',
    })
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" />
        Localizar fornecedor
      </Button>

      <DrawerDetalhes
        open={open}
        onOpenChange={setOpen}
        title="Localizador de fornecedor"
        subtitle="Busca global controlada, limitada e auditada."
      >
        <div className="space-y-4">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void handleSearch(event)}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Código ou nome do fornecedor"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </form>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Admins localizam ordens em outras carteiras, mas não ganham permissão para editar ou concluir ordens de outro responsável.
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {supplierHeading ? (
            <div className="rounded-md border px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fornecedor</p>
              <p className="mt-1 text-sm font-semibold">{supplierHeading}</p>
            </div>
          ) : null}

          {!loading && lastQuery && rows.length === 0 && !error ? (
            <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhuma ordem encontrada para esse fornecedor.
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {rows.length} resultado{rows.length !== 1 ? 's' : ''} exibido{rows.length !== 1 ? 's' : ''}. Limite: 50.
              </p>

              <div className="overflow-hidden rounded-md border">
                <div className="hidden grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_1.2fr] gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
                  <span>Ordem</span>
                  <span>Fornecedor</span>
                  <span>Unidade</span>
                  <span>Responsável</span>
                  <span>Status SAP</span>
                  <span>Ações</span>
                </div>

                <div className="divide-y">
                  {rows.map((row) => {
                    const belongsToCurrentAdmin = row.responsavel_atual_id === currentAdminId
                    return (
                      <div
                        key={row.ordem_id}
                        className="grid gap-2 px-3 py-3 text-sm transition-colors hover:bg-muted/20 lg:grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_1.2fr] lg:items-center lg:gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-mono font-semibold">{row.ordem_codigo}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.tipo_ordem ?? 'Sem tipo'} | {formatDate(row.data_entrada ?? row.ordem_detectada_em)}
                          </p>
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.fornecedor_nome ?? '-'}</p>
                          <p className="text-xs text-muted-foreground">Cód. {row.fornecedor_codigo ?? '-'}</p>
                        </div>

                        <p className="min-w-0 truncate text-muted-foreground">{row.unidade ?? row.centro ?? '-'}</p>

                        <div className="min-w-0">
                          <p className="truncate">{row.responsavel_atual_nome ?? 'Sem responsável'}</p>
                          {!belongsToCurrentAdmin ? (
                            <p className="text-xs text-amber-700 dark:text-amber-300">Outra carteira</p>
                          ) : null}
                        </div>

                        <div>
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${getRawStatusClass(row.status_ordem_raw)}`}>
                            {row.status_ordem_raw ?? getRawStatusLabel(row.status_ordem_raw)}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <Button type="button" variant="outline" size="sm" onClick={() => void copyOrder(row, 'Ordem')}>
                            <Copy className="h-3.5 w-3.5" />
                            Copiar
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDetailRow(row)}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            Detalhes
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => void copyOrder(row, 'Ordem para pedido')}>
                            Usar para pedido
                          </Button>
                        </div>

                        {row.texto_breve ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground lg:col-span-6">
                            {row.texto_breve}
                          </p>
                        ) : null}

                        {!belongsToCurrentAdmin ? (
                          <Badge variant="outline" className="w-fit bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200 lg:hidden">
                            Ordem com outro responsável
                          </Badge>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DrawerDetalhes>

      <OrdersDetailDrawer
        open={Boolean(detailRow)}
        onOpenChange={(next) => !next && setDetailRow(null)}
        ordemId={detailRow?.ordem_id ?? null}
        notaId={detailRow ? normalizeNoteId(detailRow.nota_id) : null}
        supplierLookupQuery={lastQuery}
        row={detailRow}
        canReassign={canReassign}
        reassignTargets={reassignTargets}
        allowLinkedNoteNavigation={
          Boolean(detailRow) && (canReassign || detailRow?.responsavel_atual_id === currentAdminId)
        }
        onReassigned={onReassigned}
      />
    </>
  )
}
