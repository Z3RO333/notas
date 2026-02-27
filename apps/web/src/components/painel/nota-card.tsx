'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { CheckCircle, Copy, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NotaOperacionalBadge } from '@/components/notas/nota-operacional-badge'
import { NotaStatusBadge } from '@/components/notas/nota-status-badge'
import { useToast } from '@/components/ui/toast'
import { concluirNotaRapida } from '@/lib/actions/nota-actions'
import { emitNotaOperacaoEvent, marcarNotaEmGeracao } from '@/lib/notes/copy-intent'
import { copyToClipboard } from '@/lib/orders/copy'
import type { NotaOperacaoEstado, NotaPanelData } from '@/lib/types/database'

const prioridadeLabel: Record<string, string> = {
  '1': 'Muito Alta',
  '2': 'Alta',
  '3': 'Media',
  '4': 'Baixa',
}

const prioridadeColor: Record<string, string> = {
  '1': 'border-l-red-500',
  '2': 'border-l-orange-500',
  '3': 'border-l-yellow-500',
  '4': 'border-l-green-500',
}

interface NotaCardProps {
  nota: NotaPanelData
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

export function NotaCard({ nota }: NotaCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [copyLoading, setCopyLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [conflictOwnerEmail, setConflictOwnerEmail] = useState<string | null>(null)
  const [operacaoLocal, setOperacaoLocal] = useState<NotaOperacaoEstado | null>(null)

  const prioridadeCor = nota.prioridade ? (prioridadeColor[nota.prioridade] || 'border-l-gray-300') : 'border-l-gray-300'
  const canConclude = nota.administrador_id && (nota.status === 'em_andamento' || nota.status === 'encaminhada_fornecedor')
  const estadoOperacional = operacaoLocal ?? buildCurrentStateFromNota(nota)

  async function callCopyIntent(forceOverride: boolean) {
    const result = await marcarNotaEmGeracao({ notaId: nota.id, forceOverride })
    if (result.ok) {
      setOperacaoLocal(result.data)
      emitNotaOperacaoEvent({ notaId: nota.id, state: result.data })
      toast({
        title: forceOverride
          ? `Geracao assumida para NOTA ${nota.numero_nota}`
          : `NOTA ${nota.numero_nota} em geracao`,
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
          title: 'Nota ja esta em geracao',
          description: result.ownerEmail
            ? `Responsavel atual: ${result.ownerEmail}.`
            : 'Outro responsavel ja iniciou esta geracao.',
          variant: 'info',
        })
      }
      return false
    }

    if (result.status === 403) {
      toast({
        title: 'Sem permissao para iniciar geracao',
        description: result.message,
        variant: 'error',
      })
      return false
    }

    toast({
      title: 'Falha ao marcar nota em geracao',
      description: result.message,
      variant: 'error',
    })
    return false
  }

  async function handleCopyNota(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (copyLoading) return

    const copied = await copyToClipboard(nota.numero_nota)
    if (!copied) {
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

    setCopyLoading(false)
  }

  function handleConcluirClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setConfirmOpen(true)
  }

  async function handleConfirm() {
    if (loading) return

    setLoading(true)
    setConfirmOpen(false)
    try {
      await concluirNotaRapida({
        notaId: nota.id,
      })
      toast({
        variant: 'success',
        title: 'Nota concluida',
        description: `Nota #${nota.numero_nota} foi marcada como concluida.`,
      })
      router.refresh()
    } catch {
      toast({
        variant: 'error',
        title: 'Erro ao concluir nota',
        description: 'Nao foi possivel concluir a nota. Verifique sua conexao e tente novamente.',
      })
    } finally {
      setLoading(false)
    }
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
      <Link href={`/notas/${nota.id}`}>
        <div
          className={`group rounded-lg border border-l-4 ${prioridadeCor} bg-card p-4 transition-all hover:border-l-primary hover:shadow-md cursor-pointer`}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={handleCopyNota}
              className="group inline-flex items-center gap-1 rounded px-1 -mx-1 font-mono text-sm font-bold text-foreground transition-colors hover:bg-muted"
              title={`Copiar NOTA ${nota.numero_nota}`}
            >
              #{nota.numero_nota}
              {copyLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
              )}
            </button>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <NotaOperacionalBadge
                statusOperacional={estadoOperacional?.status_operacional ?? null}
                emGeracaoPorEmail={estadoOperacional?.em_geracao_por_email ?? null}
                emGeracaoEm={estadoOperacional?.em_geracao_em ?? null}
                ttlMinutos={estadoOperacional?.ttl_minutos ?? null}
                numeroOrdemConfirmada={estadoOperacional?.numero_ordem_confirmada ?? null}
              />

              {canConclude && (
                <button
                  type="button"
                  onClick={handleConcluirClick}
                  disabled={loading}
                  className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
                  title="Concluir nota"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  Concluir
                </button>
              )}

              <NotaStatusBadge status={nota.status} />
            </div>
          </div>

          <p className="mb-3 min-h-[2.5rem] line-clamp-2 text-sm text-foreground/80">
            {nota.descricao}
          </p>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              {nota.centro && (
                <span className="rounded bg-muted px-1.5 py-0.5">{nota.centro}</span>
              )}
              {nota.prioridade && (
                <span>{prioridadeLabel[nota.prioridade] || nota.prioridade}</span>
              )}
            </div>
            {nota.data_criacao_sap && (
              <span>{format(new Date(nota.data_criacao_sap), 'dd/MM/yyyy')}</span>
            )}
          </div>
        </div>
      </Link>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Concluir nota #{nota.numero_nota}?</DialogTitle>
            <DialogDescription>
              Esta acao marcara a nota como concluida e sera registrada no historico. Tem certeza?
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={loading} className="bg-green-600 hover:bg-green-700">
              {loading ? 'Concluindo...' : 'Confirmar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nota em geracao por outro responsavel</DialogTitle>
            <DialogDescription>
              {conflictOwnerEmail
                ? `A nota esta em geracao por ${conflictOwnerEmail}. Deseja assumir a geracao?`
                : 'A nota ja esta em geracao por outro responsavel. Deseja assumir a geracao?'}
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
              {copyLoading ? 'Assumindo...' : 'Assumir geracao'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
