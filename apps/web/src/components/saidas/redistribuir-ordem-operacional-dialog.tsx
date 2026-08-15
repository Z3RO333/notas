'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { redistribuirOrdemOperacional } from '@/lib/actions/saidas-actions'

interface OperacionalOption {
  codigo: string
  nome: string
}

interface RedistribuirOrdemOperacionalDialogProps {
  saidaOrdemId: string
  ordemCodigo: string
  operacionalAtualCodigo: string
  operacionais: OperacionalOption[]
}

export function RedistribuirOrdemOperacionalDialog({
  saidaOrdemId,
  ordemCodigo,
  operacionalAtualCodigo,
  operacionais,
}: RedistribuirOrdemOperacionalDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [novoOperacionalCodigo, setNovoOperacionalCodigo] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableOptions = operacionais
    .filter((operacional) => operacional.codigo !== operacionalAtualCodigo)
    .map((operacional) => ({ value: operacional.codigo, label: operacional.nome }))

  function reset() {
    setNovoOperacionalCodigo('')
    setMotivo('')
    setError('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const normalizedReason = motivo.trim()

    if (!novoOperacionalCodigo) {
      setError('Selecione o novo operacional')
      return
    }
    if (normalizedReason.length < 5) {
      setError('Informe um motivo com pelo menos 5 caracteres')
      return
    }

    setLoading(true)
    setError('')

    const result = await redistribuirOrdemOperacional({
      saidaOrdemId,
      novoOperacionalCodigo,
      motivo: normalizedReason,
    })

    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }

    const novoNome = operacionais.find(
      (operacional) => operacional.codigo === novoOperacionalCodigo,
    )?.nome

    setOpen(false)
    reset()
    toast({
      title: 'Ordem redistribuída',
      description: `${ordemCodigo} foi enviada para ${novoNome ?? 'o novo operacional'}.`,
      variant: 'success',
    })
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs">
          <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
          Redistribuir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redistribuir ordem {ordemCodigo}</DialogTitle>
          <DialogDescription>
            A mesma ordem será movida no Cockpit e no ROTA. O SAP não será alterado nesta etapa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`novo-operacional-${saidaOrdemId}`} className="text-sm font-medium">
              Novo operacional
            </label>
            <SearchableSelect
              id={`novo-operacional-${saidaOrdemId}`}
              options={availableOptions}
              value={novoOperacionalCodigo}
              onValueChange={setNovoOperacionalCodigo}
              placeholder="Selecione o operacional..."
            />
            {availableOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhum outro operacional ativo com acesso ao ROTA está disponível.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor={`motivo-redistribuicao-${saidaOrdemId}`} className="text-sm font-medium">
              Motivo
            </label>
            <Textarea
              id={`motivo-redistribuicao-${saidaOrdemId}`}
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Ex.: mudança de disponibilidade do operacional"
              maxLength={500}
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              isLoading={loading}
              disabled={!novoOperacionalCodigo || motivo.trim().length < 5}
            >
              Confirmar redistribuição
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
