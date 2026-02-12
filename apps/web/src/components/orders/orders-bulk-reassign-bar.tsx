'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft } from 'lucide-react'
import { reatribuirOrdensSelecionadas } from '@/lib/actions/admin-actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { OrderReassignTarget } from '@/lib/types/database'

type BulkReassignMode = 'destino_unico' | 'round_robin'

interface OrdersBulkReassignBarProps {
  selectedNotaIds: string[]
  admins: OrderReassignTarget[]
  onClearSelection: () => void
  onReassigned?: (count: number) => void
}

export function OrdersBulkReassignBar({
  selectedNotaIds,
  admins,
  onClearSelection,
  onReassigned,
}: OrdersBulkReassignBarProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<BulkReassignMode>('destino_unico')
  const [destinationAdminId, setDestinationAdminId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectionCount = selectedNotaIds.length

  const isDestinationRequired = mode === 'destino_unico'
  const canSubmit = selectionCount > 0 && (!isDestinationRequired || destinationAdminId)

  const selectedLabel = useMemo(() => {
    if (selectionCount === 1) return '1 ordem selecionada'
    return `${selectionCount} ordens selecionadas`
  }, [selectionCount])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit || loading) return

    setLoading(true)
    setError('')

    try {
      const result = await reatribuirOrdensSelecionadas({
        notaIds: selectedNotaIds,
        modo: mode,
        adminDestinoId: isDestinationRequired ? destinationAdminId : undefined,
        motivo: motivo || undefined,
      })

      onReassigned?.(result.movedCount)
      setOpen(false)
      setMotivo('')
      if (mode === 'destino_unico') setDestinationAdminId('')
      onClearSelection()
      toast({
        title: 'Reatribuicao concluida',
        description: `Movidas: ${result.movedCount} | Puladas: ${result.skippedCount}`,
        variant: 'success',
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reatribuir ordens selecionadas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <p className="text-sm font-medium text-primary">{selectedLabel}</p>

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
          Limpar selecao
        </Button>

        <Dialog open={open} onOpenChange={(next) => !loading && setOpen(next)}>
          <DialogTrigger asChild>
            <Button type="button" size="sm">
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              Reatribuir selecionadas
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reatribuir ordens selecionadas</DialogTitle>
              <DialogDescription>
                Selecione o modo de reatribuicao e confirme a movimentacao das ordens selecionadas.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="bulk-mode" className="text-sm font-medium">Modo</label>
                <Select value={mode} onValueChange={(value) => setMode(value as BulkReassignMode)}>
                  <SelectTrigger id="bulk-mode">
                    <SelectValue placeholder="Selecione o modo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="destino_unico">Destino unico</SelectItem>
                    <SelectItem value="round_robin">Round-robin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isDestinationRequired && (
                <div className="space-y-2">
                  <label htmlFor="bulk-destino" className="text-sm font-medium">Destino</label>
                  <Select value={destinationAdminId} onValueChange={setDestinationAdminId}>
                    <SelectTrigger id="bulk-destino">
                      <SelectValue placeholder="Selecione o novo responsavel" />
                    </SelectTrigger>
                    <SelectContent>
                      {admins.map((admin) => (
                        <SelectItem key={admin.id} value={admin.id}>
                          {admin.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="bulk-motivo" className="text-sm font-medium">Motivo (opcional)</label>
                <Textarea
                  id="bulk-motivo"
                  placeholder="Ex: cobertura de ferias"
                  value={motivo}
                  onChange={(event) => setMotivo(event.target.value)}
                  rows={2}
                />
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Preview: {selectedLabel}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={loading} onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!canSubmit || loading}>
                  {loading ? 'Reatribuindo...' : 'Confirmar reatribuicao'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
