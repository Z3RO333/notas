'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { BulkReassignDialog } from '@/components/collaborator/bulk-reassign-dialog'
import {
  toggleDistribuicao,
  toggleFerias,
  toggleAtivo,
  atualizarMaxNotas,
  reatribuirNotasLote,
} from '@/lib/actions/admin-actions'
import type { CollaboratorData } from '@/lib/types/collaborator'

interface CollaboratorAdminActionsProps {
  admin: CollaboratorData
  destinations: Array<{ id: string; nome: string }>
}

type ToggleKind = 'ativo' | 'distribuicao' | 'ferias'

interface PendingToggle {
  kind: ToggleKind
  label: string
  value: boolean
}

export function CollaboratorAdminActions({ admin, destinations }: CollaboratorAdminActionsProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [editingMax, setEditingMax] = useState(false)
  const [maxValue, setMaxValue] = useState(admin.max_notas)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null)

  function runToggle(kind: ToggleKind, value: boolean, motivo?: string) {
    if (kind === 'ativo') return toggleAtivo(admin.id, value, motivo)
    if (kind === 'distribuicao') return toggleDistribuicao(admin.id, value, motivo)
    return toggleFerias(admin.id, value, motivo)
  }

  function shouldRequireReassign(kind: ToggleKind, newValue: boolean): boolean {
    const isBlockingState =
      (kind === 'ativo' && newValue === false)
      || (kind === 'distribuicao' && newValue === false)
      || (kind === 'ferias' && newValue === true)

    return isBlockingState && admin.qtd_abertas > 0
  }

  function handleToggle(kind: ToggleKind, label: string, newValue: boolean) {
    if (shouldRequireReassign(kind, newValue)) {
      setPendingToggle({ kind, label, value: newValue })
      setBulkOpen(true)
      return
    }

    startTransition(async () => {
      try {
        await runToggle(kind, newValue)
        toast({ title: `${label} atualizado`, variant: 'success' })
      } catch {
        toast({ title: `Erro ao atualizar ${label.toLowerCase()}`, variant: 'error' })
      }
    })
  }

  function handleSaveMax() {
    startTransition(async () => {
      try {
        await atualizarMaxNotas(admin.id, maxValue)
        toast({ title: 'Limite atualizado', variant: 'success' })
        setEditingMax(false)
      } catch {
        toast({ title: 'Erro ao atualizar limite', variant: 'error' })
      }
    })
  }

  async function handleBulkConfirm(params: { modo: 'destino_unico' | 'round_robin'; adminDestinoId?: string; motivo?: string }) {
    if (!pendingToggle) return

    await reatribuirNotasLote({
      adminOrigemId: admin.id,
      modo: params.modo,
      adminDestinoId: params.adminDestinoId,
      motivo: params.motivo,
    })
    await runToggle(pendingToggle.kind, pendingToggle.value, params.motivo)

    toast({
      title: 'Reatribuicao concluida',
      description: `${admin.qtd_abertas} nota(s) reatribuidas antes de atualizar ${pendingToggle.label.toLowerCase()}.`,
      variant: 'success',
    })

    setPendingToggle(null)
  }

  return (
    <>
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 text-sm ${isPending ? 'pointer-events-none opacity-70' : ''}`}>
        <div className="flex items-center gap-2">
          <label htmlFor={`ativo-${admin.id}`}>Ativo</label>
          <Switch
            id={`ativo-${admin.id}`}
            checked={admin.ativo}
            onCheckedChange={(v) => handleToggle('ativo', 'Status', v)}
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor={`distrib-${admin.id}`}>Distribuicao</label>
          <Switch
            id={`distrib-${admin.id}`}
            checked={admin.recebe_distribuicao}
            disabled={!admin.ativo}
            onCheckedChange={(v) => handleToggle('distribuicao', 'Distribuicao', v)}
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor={`ferias-${admin.id}`}>Ferias</label>
          <Switch
            id={`ferias-${admin.id}`}
            checked={admin.em_ferias}
            disabled={!admin.ativo}
            onCheckedChange={(v) => handleToggle('ferias', 'Ferias', v)}
          />
        </div>

        <div className="flex items-center gap-2">
          <span>Max:</span>
          {editingMax ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={100}
                value={maxValue}
                onChange={(e) => setMaxValue(Number(e.target.value))}
                className="w-14 rounded border px-2 py-0.5 text-sm text-center"
              />
              <button onClick={handleSaveMax} className="text-xs font-medium text-primary hover:underline">
                OK
              </button>
              <button
                onClick={() => { setEditingMax(false); setMaxValue(admin.max_notas) }}
                className="text-xs text-muted-foreground hover:underline"
              >
                X
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingMax(true)}
              className="font-medium text-primary hover:underline"
            >
              {admin.max_notas}
            </button>
          )}
        </div>
      </div>

      <BulkReassignDialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open)
          if (!open) setPendingToggle(null)
        }}
        adminNome={admin.nome}
        notasAbertas={admin.qtd_abertas}
        destinoOptions={destinations}
        blockingActionLabel={pendingToggle?.label.toLowerCase() ?? 'alterar disponibilidade'}
        onConfirm={handleBulkConfirm}
      />
    </>
  )
}
