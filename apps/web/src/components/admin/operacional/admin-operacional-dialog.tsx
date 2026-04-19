'use client'

import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import type { OperacionalFormState } from '@/components/admin/operacional/admin-operacionais-types'

interface AdminOperacionalDialogProps {
  open: boolean
  isPending: boolean
  form: OperacionalFormState
  /** Unidades disponíveis carregadas do banco (dim_centro_unidade) */
  todasUnidades: string[]
  onOpenChange: (open: boolean) => void
  onFormChange: (
    next: OperacionalFormState | ((prev: OperacionalFormState) => OperacionalFormState),
  ) => void
  onSave: () => void
}

export function AdminOperacionalDialog({
  open,
  isPending,
  form,
  todasUnidades,
  onOpenChange,
  onFormChange,
  onSave,
}: AdminOperacionalDialogProps) {
  const isEdit = Boolean(form.codigo)

  function isSelected(unidade: string) {
    return form.unidadesRaw.some(
      (u) => u === unidade || u.startsWith(`${unidade}||`),
    )
  }

  function toggle(unidade: string) {
    onFormChange((prev) => {
      const selected = prev.unidadesRaw.some(
        (u) => u === unidade || u.startsWith(`${unidade}||`),
      )
      if (selected) {
        return {
          ...prev,
          unidadesRaw: prev.unidadesRaw.filter(
            (u) => u !== unidade && !u.startsWith(`${unidade}||`),
          ),
        }
      }
      return { ...prev, unidadesRaw: [...prev.unidadesRaw, unidade] }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar operacional' : 'Novo operacional'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium leading-none" htmlFor="op-codigo">Código SAP</label>
              <Input
                id="op-codigo"
                value={form.codigo}
                disabled={isEdit}
                placeholder="Ex: 22016"
                onChange={(e) =>
                  onFormChange((prev) => ({ ...prev, codigo: e.target.value }))
                }
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">Código não pode ser alterado.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium leading-none" htmlFor="op-especialidade">Especialidade</label>
              <Input
                id="op-especialidade"
                value={form.especialidade}
                placeholder="Ex: Eletricidade"
                onChange={(e) =>
                  onFormChange((prev) => ({ ...prev, especialidade: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium leading-none" htmlFor="op-nome">Nome completo</label>
            <Input
              id="op-nome"
              value={form.nome}
              placeholder="Ex: EDESON MONTEIRO SOUSA"
              onChange={(e) =>
                onFormChange((prev) => ({ ...prev, nome: e.target.value }))
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Ativo</p>
              <p className="text-xs text-muted-foreground">
                Aparece nos filtros e painéis.
              </p>
            </div>
            <Switch
              checked={form.ativo}
              onCheckedChange={(checked) =>
                onFormChange((prev) => ({ ...prev, ativo: checked }))
              }
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">Lojas sob responsabilidade</label>
            <p className="text-xs text-muted-foreground">
              Clique para marcar ou desmarcar.
            </p>
            <div className="flex flex-wrap gap-2 rounded-lg border p-3">
              {todasUnidades.map((unidade) => {
                const selected = isSelected(unidade)
                return (
                  <button
                    key={unidade}
                    type="button"
                    onClick={() => toggle(unidade)}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Badge
                      variant={selected ? 'default' : 'outline'}
                      className="cursor-pointer select-none"
                    >
                      {selected && <X className="mr-1 h-3 w-3" />}
                      {unidade}
                    </Badge>
                  </button>
                )
              })}
            </div>
            {form.unidadesRaw.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {form.unidadesRaw.length}{' '}
                {form.unidadesRaw.length === 1 ? 'loja selecionada' : 'lojas selecionadas'}.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
