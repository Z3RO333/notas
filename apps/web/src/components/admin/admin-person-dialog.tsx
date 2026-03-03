'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { PersonFormState } from '@/components/admin/admin-people-types'
import {
  ESPECIALIDADE_OPTIONS,
  resolvePmplAssignment,
} from '@/components/admin/admin-people-utils'
import type { Especialidade } from '@/lib/types/database'

interface AdminPersonDialogProps {
  open: boolean
  isPending: boolean
  form: PersonFormState
  pmplResponsavelId?: string | null
  pmplSubstitutoId?: string | null
  onOpenChange: (open: boolean) => void
  onFormChange: (next: PersonFormState | ((prev: PersonFormState) => PersonFormState)) => void
  onSave: () => void
}

export function AdminPersonDialog({
  open,
  isPending,
  form,
  pmplResponsavelId = null,
  pmplSubstitutoId = null,
  onOpenChange,
  onFormChange,
  onSave,
}: AdminPersonDialogProps) {
  const assignment = form.id
    ? resolvePmplAssignment({
      personId: form.id,
      pmplResponsavelId,
      pmplSubstitutoId,
    })
    : null

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? 'Editar pessoa' : 'Adicionar pessoa'}</DialogTitle>
          <DialogDescription>
            Defina dados de acesso operacional e disponibilidade para roteamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="admin-person-nome" className="text-sm font-medium">Nome</label>
            <Input
              id="admin-person-nome"
              value={form.nome}
              onChange={(event) => onFormChange((prev) => ({ ...prev, nome: event.target.value }))}
              placeholder="Nome completo"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="admin-person-email" className="text-sm font-medium">Email</label>
            <Input
              id="admin-person-email"
              type="email"
              value={form.email}
              onChange={(event) => onFormChange((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="pessoa@bemol.com.br"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cargo</label>
              <Select
                value={form.role}
                onValueChange={(value) => onFormChange((prev) => ({ ...prev, role: value as 'admin' | 'gestor' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cargo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="gestor">Gestor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Especialidade / Funcao</label>
              <Select
                value={form.especialidade}
                onValueChange={(value) => onFormChange((prev) => ({ ...prev, especialidade: value as Especialidade }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a funcao" />
                </SelectTrigger>
                <SelectContent>
                  {ESPECIALIDADE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignment === 'responsavel' && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Esta pessoa esta configurada como PMPL Responsavel.
                </p>
              )}
              {assignment === 'substituto' && (
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Esta pessoa esta configurada como PMPL Substituto.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>Ativo</span>
              <Switch
                checked={form.ativo}
                onCheckedChange={(checked) => onFormChange((prev) => ({ ...prev, ativo: checked }))}
              />
            </label>

            <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>Em ferias</span>
              <Switch
                checked={form.emFerias}
                onCheckedChange={(checked) => onFormChange((prev) => ({ ...prev, emFerias: checked }))}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="admin-person-data-inicio" className="text-sm font-medium">Data inicio ferias</label>
              <Input
                id="admin-person-data-inicio"
                type="date"
                value={form.dataInicioFerias}
                onChange={(event) => onFormChange((prev) => ({ ...prev, dataInicioFerias: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="admin-person-data-fim" className="text-sm font-medium">Data fim ferias</label>
              <Input
                id="admin-person-data-fim"
                type="date"
                value={form.dataFimFerias}
                onChange={(event) => onFormChange((prev) => ({ ...prev, dataFimFerias: event.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={isPending} onClick={onSave}>
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
