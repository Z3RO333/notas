'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import {
  previewRealocarCarteiraPmpl,
  realocarCarteiraPmplFornecedor,
  type PmplCarteiraPreview,
} from '@/lib/actions/pmpl-carteira-actions'

interface AdminCandidate {
  id: string
  nome: string | null
  email: string
}

interface PmplRealocarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fornecedorCodigo: string
  fornecedorNome: string | null
  adminAtualId: string | null
  adminAtualNome: string | null
  candidates: AdminCandidate[]
}

export function PmplRealocarDialog({
  open,
  onOpenChange,
  fornecedorCodigo,
  fornecedorNome,
  adminAtualId,
  adminAtualNome,
  candidates,
}: PmplRealocarDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const [novoAdminId, setNovoAdminId] = useState<string>('')
  const [motivo, setMotivo] = useState('')
  const [preview, setPreview] = useState<PmplCarteiraPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [etapa, setEtapa] = useState<'selecao' | 'confirmacao'>('selecao')

  function handleClose() {
    setNovoAdminId('')
    setMotivo('')
    setPreview(null)
    setPreviewError(null)
    setEtapa('selecao')
    onOpenChange(false)
  }

  function handleVerImpacto() {
    if (!novoAdminId) return

    startTransition(async () => {
      setPreviewError(null)
      const result = await previewRealocarCarteiraPmpl(fornecedorCodigo, novoAdminId)
      if (result.error || !result.data) {
        setPreviewError(result.error ?? 'Erro ao carregar preview')
        return
      }
      setPreview(result.data)
      setEtapa('confirmacao')
    })
  }

  function handleConfirmar() {
    startTransition(async () => {
      const result = await realocarCarteiraPmplFornecedor(
        fornecedorCodigo,
        novoAdminId,
        motivo || undefined,
      )

      if (result.error || !result.data) {
        toast({
          title: 'Erro na realocação',
          description: result.error ?? 'Erro inesperado',
          variant: 'error',
        })
        return
      }

      toast({
        title: 'Carteira realocada',
        description: `${result.data.qtdOrdendsAbertasAfetadas} ordens reatribuídas para ${result.data.adminNovoNome ?? 'novo responsável'}.`,
        variant: 'success',
      })

      handleClose()
      router.refresh()
    })
  }

  const candidatesFiltered = candidates.filter((c) => c.id !== adminAtualId)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trocar responsável</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {fornecedorNome ?? fornecedorCodigo}
          </DialogDescription>
        </DialogHeader>

        {etapa === 'selecao' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Responsável atual
              </p>
              <p className="text-sm font-medium">{adminAtualNome ?? '—'}</p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Novo responsável
              </p>
              <Select value={novoAdminId} onValueChange={setNovoAdminId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar administrador…" />
                </SelectTrigger>
                <SelectContent>
                  {candidatesFiltered.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome ?? c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Motivo <span className="font-normal normal-case">(opcional)</span>
              </p>
              <Textarea
                placeholder="Ex: Mayky entrou de férias"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                className="resize-none text-sm"
              />
            </div>

            {previewError && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {previewError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose} disabled={isPending}>
                Cancelar
              </Button>
              <Button onClick={handleVerImpacto} disabled={!novoAdminId || isPending}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>Ver impacto <ArrowRight className="ml-1.5 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {etapa === 'confirmacao' && preview && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-3 text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <span className="text-muted-foreground">Fornecedor</span>
                <span className="font-medium">{preview.fornecedorNome ?? preview.fornecedorCodigo}</span>
                <span className="text-muted-foreground">Atual</span>
                <span>{preview.adminAtualNome ?? '—'}</span>
                <span className="text-muted-foreground">Novo</span>
                <span className="font-semibold">{preview.adminNovoNome}</span>
              </div>

              <div className="border-t border-border/40 pt-3 space-y-1.5">
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                  {preview.qtdOrdendsAbertas.toLocaleString('pt-BR')} ordens abertas serão reatribuídas
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-4 w-4 shrink-0 inline-flex items-center justify-center text-xs">⏭</span>
                  {preview.qtdOrdensIgnoradas.toLocaleString('pt-BR')} ordens encerradas são ignoradas
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEtapa('selecao')} disabled={isPending}>
                ← Voltar
              </Button>
              <Button onClick={handleConfirmar} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Confirmar realocação'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
