'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { AdminOperacionalDialog } from '@/components/admin/operacional/admin-operacional-dialog'
import { AdminOperacionaisTable } from '@/components/admin/operacional/admin-operacionais-table'
import {
  EMPTY_OPERACIONAL_FORM,
  parseUnidadesRaw,
  toOperacionalFormState,
  type OperacionalAdmin,
  type OperacionalFormState,
} from '@/components/admin/operacional/admin-operacionais-types'
import {
  salvarOperacionalAdmin,
  salvarUnidadesOperacional,
} from '@/lib/actions/operacional-actions'

interface AdminOperacionaisManagerProps {
  operacionais: OperacionalAdmin[]
  /** Unidades disponíveis vindas do banco (dim_centro_unidade) */
  todasUnidades: string[]
}

export function AdminOperacionaisManager({
  operacionais,
  todasUnidades,
}: AdminOperacionaisManagerProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<OperacionalFormState>(EMPTY_OPERACIONAL_FORM)

  const sorted = useMemo(
    () => [...operacionais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [operacionais],
  )

  function openForCreate() {
    setForm(EMPTY_OPERACIONAL_FORM)
    setDialogOpen(true)
  }

  function openForEdit(op: OperacionalAdmin) {
    setForm(toOperacionalFormState(op))
    setDialogOpen(true)
  }

  function handleQuickUpdate(op: OperacionalAdmin, patch: Partial<OperacionalFormState>) {
    startTransition(async () => {
      try {
        await salvarOperacionalAdmin({
          codigo: op.codigo,
          nome: patch.nome ?? op.nome,
          ativo: patch.ativo ?? op.ativo,
          especialidade: patch.especialidade !== undefined ? patch.especialidade || null : op.especialidade,
        })
        toast({ title: 'Operacional atualizado', variant: 'success' })
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao atualizar operacional',
          description: error instanceof Error ? error.message : 'Falha inesperada',
          variant: 'error',
        })
      }
    })
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await salvarOperacionalAdmin({
          codigo: form.codigo,
          nome: form.nome,
          ativo: form.ativo,
          especialidade: form.especialidade || null,
        })
        await salvarUnidadesOperacional(form.codigo, parseUnidadesRaw(form.unidadesRaw))

        toast({
          title: form.codigo ? 'Operacional salvo' : 'Operacional adicionado',
          variant: 'success',
        })
        setDialogOpen(false)
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao salvar operacional',
          description: error instanceof Error ? error.message : 'Falha inesperada',
          variant: 'error',
        })
      }
    })
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Operacionais</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie eletricistas e outros operacionais e as lojas que atendem.
          </p>
        </div>
        <Button type="button" onClick={openForCreate} disabled={isPending}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar operacional
        </Button>
      </div>

      <AdminOperacionaisTable
        operacionais={sorted}
        isPending={isPending}
        onEdit={openForEdit}
        onQuickUpdate={handleQuickUpdate}
      />

      <AdminOperacionalDialog
        open={dialogOpen}
        isPending={isPending}
        form={form}
        todasUnidades={todasUnidades}
        onOpenChange={setDialogOpen}
        onFormChange={(next) =>
          setForm((prev) => (typeof next === 'function' ? next(prev) : next))
        }
        onSave={handleSave}
      />
    </div>
  )
}
