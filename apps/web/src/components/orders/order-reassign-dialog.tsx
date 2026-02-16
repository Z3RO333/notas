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
import { Textarea } from '@/components/ui/textarea'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { reatribuirNota } from '@/lib/actions/nota-actions'
import type { OrderReassignTarget } from '@/lib/types/database'

interface OrderReassignDialogProps {
  notaId: string
  notaNumero: string
  ordemCodigo: string
  currentAdminId: string | null
  admins: OrderReassignTarget[]
}

export function OrderReassignDialog({
  notaId,
  notaNumero,
  ordemCodigo,
  currentAdminId,
  admins,
}: OrderReassignDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedAdmin, setSelectedAdmin] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableAdmins = admins.filter((admin) => admin.id !== currentAdminId)
  const adminOptions = availableAdmins.map((a) => ({ value: a.id, label: a.nome }))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedAdmin) return

    setLoading(true)
    setError('')

    try {
      await reatribuirNota({
        notaId,
        novoAdminId: selectedAdmin,
        motivo: motivo || undefined,
      })

      setOpen(false)
      setSelectedAdmin('')
      setMotivo('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reatribuir ordem')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && setOpen(next)}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs">
          <ArrowRightLeft className="mr-1 h-3 w-3" />
          Reatribuir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reatribuir ordem {ordemCodigo}</DialogTitle>
          <DialogDescription>
            Nota #{notaNumero}. Selecione o novo responsavel para continuidade da tratativa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`ordem-destino-${notaId}`} className="text-sm font-medium">Novo responsavel</label>
            <SearchableSelect
              id={`ordem-destino-${notaId}`}
              options={adminOptions}
              value={selectedAdmin}
              onValueChange={setSelectedAdmin}
              placeholder="Selecione o admin..."
            />
            {availableAdmins.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum administrador elegivel disponivel.</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor={`ordem-motivo-${notaId}`} className="text-sm font-medium">Motivo (opcional)</label>
            <Textarea
              id={`ordem-motivo-${notaId}`}
              placeholder="Ex: reatribuicao por ausencia/ferias"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={loading} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!selectedAdmin} isLoading={loading}>
              Confirmar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
