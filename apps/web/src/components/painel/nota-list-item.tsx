'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getAgingBadge, getAgingBucket, isOpenStatus } from '@/lib/collaborator/aging'
import { emitNotaOperacaoEvent, marcarNotaEmGeracao } from '@/lib/notes/copy-intent'
import { copyToClipboard } from '@/lib/orders/copy'
import type { NotaOperacaoEstado, NotaPanelData } from '@/lib/types/database'

interface NotaListItemProps {
  nota: NotaPanelData
  allowOperationalActions?: boolean
}

function buildCurrentStateFromNota(nota: NotaPanelData): NotaOperacaoEstado | null {
  if (!nota.status_operacional) return null
  const nowIso = new Date().toISOString()
  return {
    nota_id: nota.id,
    numero_nota: nota.numero_nota,
    status_operacional: nota.status_operacional,
    em_geracao_por_admin_id: nota.em_geracao_por_admin_id ?? null,
    em_geracao_por_email: nota.em_geracao_por_email ?? null,
    em_geracao_em: nota.em_geracao_em ?? null,
    ultima_copia_em: nota.ultima_copia_em ?? null,
    ttl_minutos: Number(nota.ttl_minutos ?? 60),
    numero_ordem_confirmada: nota.numero_ordem_confirmada ?? null,
    confirmada_em: nota.confirmada_em ?? null,
    created_at: nowIso,
    updated_at: nowIso,
  }
}

export function NotaListItem({ nota, allowOperationalActions = true }: NotaListItemProps) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [copyLoading, setCopyLoading] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [conflictOwnerEmail, setConflictOwnerEmail] = useState<string | null>(null)
  const [operacaoLocal, setOperacaoLocal] = useState<NotaOperacaoEstado | null>(null)
  const unidadeLabel = nota.denominacao_unidade?.trim() || nota.centro?.trim() || null
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const aging = isOpenStatus(nota.status)
    ? getAgingBadge(getAgingBucket(nota))
    : {
      label: nota.status === 'concluida' ? 'Concluida' : 'Cancelada',
      chip: 'bg-slate-100 text-slate-600',
    }

  const createdLabel = nota.data_criacao_sap
    ? format(new Date(`${nota.data_criacao_sap}T00:00:00`), 'dd/MM')
    : format(new Date(nota.created_at), 'dd/MM')

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  async function callCopyIntent(forceOverride: boolean) {
    const result = await marcarNotaEmGeracao({ notaId: nota.id, forceOverride })
    if (result.ok) {
      setOperacaoLocal(result.data)
      emitNotaOperacaoEvent({ notaId: nota.id, state: result.data })
      toast({
        title: forceOverride
          ? `Geração assumida para NOTA ${nota.numero_nota}`
          : `NOTA ${nota.numero_nota} em geração`,
        variant: 'success',
      })
      return true
    }

    if (result.status === 409 && result.code === 'already_in_progress_by_other') {
      setConflictOwnerEmail(result.ownerEmail)
      if (result.canOverride) {
        setOverrideOpen(true)
      } else {
        toast({
          title: 'Nota já está em geração',
          description: result.ownerEmail
            ? `Responsável atual: ${result.ownerEmail}.`
            : 'Outro responsável já iniciou esta geração.',
          variant: 'info',
        })
      }
      return false
    }

    if (result.status === 403) {
      toast({
        title: 'Sem permissão para iniciar geração',
        description: result.message,
        variant: 'error',
      })
      return false
    }

    toast({
      title: 'Falha ao marcar nota em geração',
      description: result.message,
      variant: 'error',
    })
    return false
  }

  async function handleCopyAction() {
    if (copyLoading) return

    const copiedOk = await copyToClipboard(nota.numero_nota)
    if (!copiedOk) {
      toast({
        title: 'Falha ao copiar NOTA',
        variant: 'error',
      })
      return
    }

    const previousState = operacaoLocal ?? buildCurrentStateFromNota(nota)
    const optimisticNow = new Date().toISOString()

    setCopyLoading(true)
    setOperacaoLocal({
      nota_id: nota.id,
      numero_nota: nota.numero_nota,
      status_operacional: 'EM_GERACAO',
      em_geracao_por_admin_id: previousState?.em_geracao_por_admin_id ?? null,
      em_geracao_por_email: previousState?.em_geracao_por_email ?? null,
      em_geracao_em: optimisticNow,
      ultima_copia_em: optimisticNow,
      ttl_minutos: Number(previousState?.ttl_minutos ?? nota.ttl_minutos ?? 60),
      numero_ordem_confirmada: null,
      confirmada_em: null,
      created_at: previousState?.created_at ?? optimisticNow,
      updated_at: optimisticNow,
    })

    const marked = await callCopyIntent(false)
    if (!marked) {
      setOperacaoLocal(previousState)
      setCopyLoading(false)
      return
    }

    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500)
    setCopyLoading(false)
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    void handleCopyAction()
  }

  async function handleOverrideConfirm() {
    if (copyLoading) return
    setOverrideOpen(false)
    setCopyLoading(true)

    const marked = await callCopyIntent(true)
    if (!marked) {
      setOperacaoLocal(buildCurrentStateFromNota(nota))
    }

    setCopyLoading(false)
  }

  return (
    <>
      <div
        role={allowOperationalActions ? 'button' : undefined}
        tabIndex={allowOperationalActions ? 0 : undefined}
        onClick={allowOperationalActions ? () => { void handleCopyAction() } : undefined}
        onKeyDown={allowOperationalActions ? handleRowKeyDown : undefined}
        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors ${allowOperationalActions ? 'cursor-pointer select-none hover:bg-muted/40' : 'bg-muted/10'}`}
        title={allowOperationalActions ? `Clique para copiar #${nota.numero_nota}` : undefined}
      >
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-semibold text-foreground">
            #{nota.numero_nota}
          </p>
          <p className="truncate text-sm text-muted-foreground">{nota.descricao}</p>
          {unidadeLabel && (
            <p className="truncate text-xs text-muted-foreground/80">{unidadeLabel}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {copied ? (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Copiado
            </span>
          ) : (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${aging.chip}`}>
              {aging.label}
            </span>
          )}
          <span className="w-10 text-right text-xs text-muted-foreground">{createdLabel}</span>
          <Link
            href={`/notas/${nota.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground"
            title="Abrir nota"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nota em geração por outro responsável</DialogTitle>
            <DialogDescription>
              {conflictOwnerEmail
                ? `A nota está em geração por ${conflictOwnerEmail}. Deseja assumir a geração?`
                : 'A nota já está em geração por outro responsável. Deseja assumir a geração?'}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleOverrideConfirm}
              disabled={copyLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {copyLoading ? 'Assumindo...' : 'Assumir geração'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
