'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
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
import { realocarCarteiraFornecedorPedidos } from '@/lib/actions/pedidos-carteira-fornecedor-actions'

interface AdminCandidate {
  id: string
  nome: string | null
  avatar_url: string | null
}

interface PedidosCarteiraRealocarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fornecedorCodigo: string
  fornecedorNome: string
  adminAtualId: string | null
  adminAtualNome: string | null
  candidates: AdminCandidate[]
}

export function PedidosCarteiraRealocarDialog({
  open,
  onOpenChange,
  fornecedorCodigo,
  fornecedorNome,
  adminAtualId,
  adminAtualNome,
  candidates,
}: PedidosCarteiraRealocarDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const [novoAdminId, setNovoAdminId] = useState<string>('')
  const [motivo, setMotivo] = useState('')

  function handleClose() {
    setNovoAdminId('')
    setMotivo('')
    onOpenChange(false)
  }

  function handleConfirmar() {
    if (!novoAdminId) return

    startTransition(async () => {
      const result = await realocarCarteiraFornecedorPedidos(
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
        description: `${fornecedorNome} agora é responsabilidade de ${result.data.adminNovoNome ?? 'novo responsável'}. Pedidos antigos não são alterados.`,
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
          <DialogTitle>Realocar fornecedor</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {fornecedorNome} (cod. {fornecedorCodigo})
          </DialogDescription>
        </DialogHeader>

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
                <SelectValue placeholder="Selecionar administrador geral…" />
              </SelectTrigger>
              <SelectContent>
                {candidatesFiltered.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome ?? c.id}
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
              placeholder="Ex: ajuste de carga entre administradores gerais"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A realocação muda o responsável apenas a partir de agora — pedidos já existentes
            deste fornecedor não são reatribuídos.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={!novoAdminId || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar realocação'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
