'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type BulkMode = 'destino_unico' | 'round_robin'

interface DestinationOption {
  id: string
  nome: string
}

interface BulkReassignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  adminNome: string
  notasAbertas: number
  destinoOptions: DestinationOption[]
  blockingActionLabel: string
  onConfirm: (params: { modo: BulkMode; adminDestinoId?: string; motivo?: string }) => Promise<void>
}

export function BulkReassignDialog({
  open,
  onOpenChange,
  adminNome,
  notasAbertas,
  destinoOptions,
  blockingActionLabel,
  onConfirm,
}: BulkReassignDialogProps) {
  const [modo, setModo] = useState<BulkMode>('destino_unico')
  const [destino, setDestino] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isDestinoObrigatorio = modo === 'destino_unico'
  const hasEligibleDestinations = destinoOptions.length > 0
  const canSubmit = !loading && hasEligibleDestinations && (!isDestinoObrigatorio || Boolean(destino))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError('')
    try {
      await onConfirm({
        modo,
        adminDestinoId: modo === 'destino_unico' ? destino : undefined,
        motivo: motivo || undefined,
      })
      setDestino('')
      setMotivo('')
      setModo('destino_unico')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reatribuir em lote')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reatribuicao obrigatoria antes de {blockingActionLabel}</DialogTitle>
          <DialogDescription>
            {adminNome} possui {notasAbertas} nota(s) aberta(s). Reatribua antes de concluir esta alteracao.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="modo-lote" className="text-sm font-medium">Modo de distribuicao</label>
            <Select value={modo} onValueChange={(value) => setModo(value as BulkMode)}>
              <SelectTrigger id="modo-lote">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="destino_unico">Destino unico</SelectItem>
                <SelectItem value="round_robin">Distribuicao igual (round-robin)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {modo === 'destino_unico' && (
            <div className="space-y-2">
              <label htmlFor="destino-lote" className="text-sm font-medium">Destino das notas</label>
              <Select value={destino} onValueChange={setDestino}>
                <SelectTrigger id="destino-lote">
                  <SelectValue placeholder="Selecione o novo responsavel..." />
                </SelectTrigger>
                <SelectContent>
                  {destinoOptions.map((admin) => (
                    <SelectItem key={admin.id} value={admin.id}>
                      {admin.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!hasEligibleDestinations && (
                <p className="text-xs text-destructive">
                  Nao existem administradores elegiveis (ativos e fora de ferias) para receber estas notas.
                </p>
              )}
            </div>
          )}

          {modo === 'round_robin' && !hasEligibleDestinations && (
            <p className="text-xs text-destructive">
              Round-robin indisponivel: nao existem administradores elegiveis no momento.
            </p>
          )}

          <div className="space-y-2">
            <label htmlFor="motivo-lote" className="text-sm font-medium">Motivo (opcional)</label>
            <Textarea
              id="motivo-lote"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: colaborador entrou em ferias"
              rows={2}
            />
          </div>

          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Preview: {notasAbertas} nota(s) aberta(s) serao reatribuidas.
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? 'Reatribuindo...' : 'Confirmar e continuar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
