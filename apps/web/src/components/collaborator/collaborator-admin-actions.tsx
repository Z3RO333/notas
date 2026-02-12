'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import {
  toggleDistribuicao,
  toggleFerias,
  toggleAtivo,
  atualizarMaxNotas,
} from '@/lib/actions/admin-actions'
import type { CollaboratorData } from '@/lib/types/collaborator'

interface CollaboratorAdminActionsProps {
  admin: CollaboratorData
}

export function CollaboratorAdminActions({ admin }: CollaboratorAdminActionsProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [editingMax, setEditingMax] = useState(false)
  const [maxValue, setMaxValue] = useState(admin.max_notas)

  function handleToggle(
    action: (id: string, valor: boolean, motivo?: string) => Promise<void>,
    label: string,
    newValue: boolean
  ) {
    startTransition(async () => {
      try {
        await action(admin.id, newValue)
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

  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 text-sm ${isPending ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <label htmlFor={`ativo-${admin.id}`}>Ativo</label>
        <Switch
          id={`ativo-${admin.id}`}
          checked={admin.ativo}
          onCheckedChange={(v) => handleToggle(toggleAtivo, 'Status', v)}
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`distrib-${admin.id}`}>Distribuicao</label>
        <Switch
          id={`distrib-${admin.id}`}
          checked={admin.recebe_distribuicao}
          disabled={!admin.ativo}
          onCheckedChange={(v) => handleToggle(toggleDistribuicao, 'Distribuicao', v)}
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`ferias-${admin.id}`}>Ferias</label>
        <Switch
          id={`ferias-${admin.id}`}
          checked={admin.em_ferias}
          disabled={!admin.ativo}
          onCheckedChange={(v) => handleToggle(toggleFerias, 'Ferias', v)}
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
  )
}
