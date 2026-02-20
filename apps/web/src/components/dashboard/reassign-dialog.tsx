'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ArrowRightLeft } from 'lucide-react'
import { reatribuirNota } from '@/lib/actions/nota-actions'
import type { Administrador } from '@/lib/types/database'

interface ReassignDialogProps {
  notaId: string
  notaNumero: string
  currentAdminId: string | null
  admins: Administrador[]
}

export function ReassignDialog({ notaId, notaNumero, currentAdminId, admins }: ReassignDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedAdmin, setSelectedAdmin] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableAdmins = admins.filter(
    (a) => a.ativo && !a.em_ferias && a.role === 'admin' && a.id !== currentAdminId
  )

  const adminOptions = availableAdmins.map((a) => ({ value: a.id, label: a.nome }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
      setError(err instanceof Error ? err.message : 'Erro ao reatribuir')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowRightLeft className="mr-2 h-3 w-3" />
          Reatribuir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reatribuir Nota {notaNumero}</DialogTitle>
          <DialogDescription>
            Mover esta nota para outro administrador.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="novo-responsavel" className="text-sm font-medium">Novo Responsável</label>
            <SearchableSelect
              id="novo-responsavel"
              options={adminOptions}
              value={selectedAdmin}
              onValueChange={setSelectedAdmin}
              placeholder="Selecione o admin..."
            />
            {availableAdmins.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhum administrador elegível disponível no momento.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="motivo-reatribuicao" className="text-sm font-medium">Motivo (opcional)</label>
            <Textarea
              id="motivo-reatribuicao"
              placeholder="Motivo da reatribuição..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
