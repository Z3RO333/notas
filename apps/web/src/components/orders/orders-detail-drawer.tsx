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
  ordemId: string | null
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

function normalizeNoteId(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

export function OrdersDetailDrawer({
  open,
  onOpenChange,
  ordemId,
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
    if (!open) return
    const safeOrdemId = ordemId?.trim() || null
    const safeNotaId = normalizeNoteId(notaId)
    if (!safeOrdemId && !safeNotaId) return

    const controller = new AbortController()
    async function run() {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        if (safeOrdemId) {
          params.set('ordemId', safeOrdemId)
        } else if (safeNotaId) {
          params.set('notaId', safeNotaId)
        }

        const response = await fetch(`/api/ordens/detalhe?${params.toString()}`, {
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
  }, [open, ordemId, notaId])

  const current = useMemo(() => data?.ordem ?? row, [data, row])
  const ordemCodigo = current?.ordem_codigo?.trim() ? current.ordem_codigo : 'Sem ordem'
  const notaNumero = current?.numero_nota?.trim() ? current.numero_nota : 'Sem número'
  const linkedNotaId = normalizeNoteId(current?.nota_id ?? notaId)
  const title = current
    ? (linkedNotaId
      ? `Nota ${notaNumero} • Ordem ${ordemCodigo}`
      : `Ordem ${ordemCodigo} • Sem nota vinculada`)
    : 'Detalhes da ordem'
  const subtitle = current?.descricao ?? data?.descricao_nota ?? (!linkedNotaId ? 'Ordem PMPL sem nota vinculada.' : undefined)
  const canReassignByNote = canReassign && Boolean(linkedNotaId) && reassignTargets.length > 0

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

          {canReassignByNote && linkedNotaId && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Ações rápidas</p>
              <OrderReassignDialog
                notaId={linkedNotaId}
                notaNumero={notaNumero}
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

          {linkedNotaId ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/notas/${linkedNotaId}`}>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Abrir detalhe completo
              </Link>
            </Button>
          ) : (
            <div className="space-y-2">
              <Button type="button" variant="outline" className="w-full" disabled>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Nota não vinculada
              </Button>
              <p className="text-xs text-muted-foreground">
                Esta ordem não possui nota vinculada para abertura do detalhe completo.
              </p>
            </div>
          )}
        </div>
      )}
    </DrawerDetalhes>
  )
}
