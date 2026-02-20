'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRightLeft, Clock3, Loader2 } from 'lucide-react'
import { DrawerDetalhes } from '@/components/shared/drawer-detalhes'
import { Button } from '@/components/ui/button'
import { OrderReassignDialog } from '@/components/orders/order-reassign-dialog'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
} from '@/lib/orders/metrics'
import type {
  OrderDetailDrawerData,
  OrdemNotaAcompanhamento,
  OrderReassignTarget,
} from '@/lib/types/database'

interface OrdersDetailDrawerProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  notaId: string | null
  row: OrdemNotaAcompanhamento | null
  canReassign: boolean
  reassignTargets: OrderReassignTarget[]
  onReassigned?: (payload: { notaId: string; novoAdminId: string }) => void
}

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('pt-BR')
}

export function OrdersDetailDrawer({
  open,
  onOpenChange,
  notaId,
  row,
  canReassign,
  reassignTargets,
  onReassigned,
}: OrdersDetailDrawerProps) {
  const [data, setData] = useState<OrderDetailDrawerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !notaId) return
    const safeNotaId = notaId

    const controller = new AbortController()
    async function run() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/ordens/detalhe?notaId=${encodeURIComponent(safeNotaId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload.error || 'Falha ao carregar detalhes da ordem')
        }
        const payload = (await response.json()) as OrderDetailDrawerData
        setData(payload)
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return
        setData(null)
        setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar detalhes da ordem')
      } finally {
        setLoading(false)
      }
    }

    run()
    return () => controller.abort()
  }, [open, notaId])

  const current = useMemo(() => data?.ordem ?? row, [data, row])
  const title = current ? `Nota ${current.numero_nota} • Ordem ${current.ordem_codigo}` : 'Detalhes da ordem'
  const subtitle = current?.descricao ?? data?.descricao_nota ?? undefined

  return (
    <DrawerDetalhes
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
    >
      {!current ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nenhuma ordem selecionada.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Status</p>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getOrderStatusClass(current.status_ordem)}`}>
                {getOrderStatusLabel(current.status_ordem)}
              </span>
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Prioridade</p>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(current.semaforo_atraso)}`}>
                {getSemaforoLabel(current.semaforo_atraso)}
              </span>
            </div>
          </div>

          <div className="rounded-lg border p-3 text-sm">
            <p><span className="text-muted-foreground">Responsável atual:</span> {current.responsavel_atual_nome ?? 'Sem responsável'}</p>
            <p><span className="text-muted-foreground">Responsável origem:</span> {current.administrador_nome ?? 'Não identificado'}</p>
            <p><span className="text-muted-foreground">Unidade:</span> {current.unidade ?? 'Sem unidade'}</p>
            <p><span className="text-muted-foreground">Dias em aberto:</span> {current.dias_em_aberto}</p>
            <p><span className="text-muted-foreground">Detectada em:</span> {formatIsoDate(current.ordem_detectada_em)}</p>
          </div>

          {canReassign && reassignTargets.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Acoes rapidas</p>
              <OrderReassignDialog
                notaId={current.nota_id}
                notaNumero={current.numero_nota}
                ordemCodigo={current.ordem_codigo}
                currentAdminId={current.responsavel_atual_id}
                admins={reassignTargets}
                skipRouterRefresh
                onReassigned={onReassigned}
              />
            </div>
          )}

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              Histórico recente
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando detalhes...
              </div>
            )}

            {!loading && error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {!loading && !error && (data?.timeline?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">Sem histórico recente.</p>
            )}

            {!loading && !error && (data?.timeline?.length ?? 0) > 0 && (
              <div className="space-y-2">
                {(data?.timeline ?? []).map((event) => (
                  <div key={event.id} className="rounded-md border px-2.5 py-2 text-sm">
                    <p className="font-medium">{event.titulo}</p>
                    <p className="text-xs text-muted-foreground">{event.descricao}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{formatIsoDate(event.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button asChild variant="outline" className="w-full">
            <Link href={`/notas/${current.nota_id}`}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Abrir detalhe completo
            </Link>
          </Button>
        </div>
      )}
    </DrawerDetalhes>
  )
}
