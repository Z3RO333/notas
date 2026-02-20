'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil } from 'lucide-react'
import { salvarPessoaAdmin } from '@/lib/actions/admin-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

interface AdminPerson {
  id: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  ativo: boolean
  em_ferias: boolean
  data_inicio_ferias: string | null
  data_fim_ferias: string | null
}

interface PersonFormState {
  id?: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  ativo: boolean
  emFerias: boolean
  dataInicioFerias: string
  dataFimFerias: string
}

interface AdminPeopleManagerProps {
  people: AdminPerson[]
}

const EMPTY_FORM: PersonFormState = {
  nome: '',
  email: '',
  role: 'admin',
  ativo: true,
  emFerias: false,
  dataInicioFerias: '',
  dataFimFerias: '',
}

function toForm(person: AdminPerson): PersonFormState {
  return {
    id: person.id,
    nome: person.nome,
    email: person.email,
    role: person.role,
    ativo: person.ativo,
    emFerias: person.em_ferias,
    dataInicioFerias: person.data_inicio_ferias ?? '',
    dataFimFerias: person.data_fim_ferias ?? '',
  }
}

export function AdminPeopleManager({ people }: AdminPeopleManagerProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<PersonFormState>(EMPTY_FORM)

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [people]
  )

  function openForCreate() {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openForEdit(person: AdminPerson) {
    setForm(toForm(person))
    setDialogOpen(true)
  }

  function handleQuickUpdate(person: AdminPerson, patch: Partial<PersonFormState>) {
    startTransition(async () => {
      try {
        await salvarPessoaAdmin({
          id: person.id,
          nome: patch.nome ?? person.nome,
          email: patch.email ?? person.email,
          role: patch.role ?? person.role,
          ativo: patch.ativo ?? person.ativo,
          emFerias: patch.emFerias ?? person.em_ferias,
          dataInicioFerias: patch.dataInicioFerias ?? person.data_inicio_ferias,
          dataFimFerias: patch.dataFimFerias ?? person.data_fim_ferias,
        })

        toast({ title: 'Pessoa atualizada', variant: 'success' })
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao atualizar pessoa',
          description: error instanceof Error ? error.message : 'Falha inesperada',
          variant: 'error',
        })
      }
    })
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await salvarPessoaAdmin({
          id: form.id,
          nome: form.nome,
          email: form.email,
          role: form.role,
          ativo: form.ativo,
          emFerias: form.emFerias,
          dataInicioFerias: form.dataInicioFerias || null,
          dataFimFerias: form.dataFimFerias || null,
        })

        toast({
          title: form.id ? 'Pessoa atualizada' : 'Pessoa adicionada',
          variant: 'success',
        })
        setDialogOpen(false)
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao salvar pessoa',
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
          <h3 className="text-base font-semibold">Pessoas</h3>
          <p className="text-sm text-muted-foreground">
            Cadastre e edite pessoas que podem atuar no módulo de ordens.
          </p>
        </div>
        <Button type="button" onClick={openForCreate} disabled={isPending}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar pessoa
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2 text-left font-medium">Nome</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Cargo</th>
              <th className="px-3 py-2 text-left font-medium">Ativo</th>
              <th className="px-3 py-2 text-left font-medium">Em férias</th>
              <th className="px-3 py-2 text-left font-medium">Período</th>
              <th className="px-3 py-2 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {sortedPeople.map((person) => (
              <tr key={person.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{person.nome}</td>
                <td className="px-3 py-2 text-muted-foreground">{person.email}</td>
                <td className="px-3 py-2 uppercase">{person.role}</td>
                <td className="px-3 py-2">
                  <Switch
                    checked={person.ativo}
                    onCheckedChange={(checked) => handleQuickUpdate(person, { ativo: checked })}
                    disabled={isPending}
                  />
                </td>
                <td className="px-3 py-2">
                  <Switch
                    checked={person.em_ferias}
                    onCheckedChange={(checked) => handleQuickUpdate(person, { emFerias: checked })}
                    disabled={isPending}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {person.data_inicio_ferias || person.data_fim_ferias
                    ? `${person.data_inicio_ferias ?? '—'} até ${person.data_fim_ferias ?? '—'}`
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => openForEdit(person)} disabled={isPending}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !isPending && setDialogOpen(open)}>
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
                onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))}
                placeholder="Nome completo"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="admin-person-email" className="text-sm font-medium">Email</label>
              <Input
                id="admin-person-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="pessoa@bemol.com.br"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cargo</label>
              <Select value={form.role} onValueChange={(value) => setForm((prev) => ({ ...prev, role: value as 'admin' | 'gestor' }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cargo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="gestor">Gestor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>Ativo</span>
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, ativo: checked }))}
                />
              </label>

              <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>Em férias</span>
                <Switch
                  checked={form.emFerias}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, emFerias: checked }))}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="admin-person-data-inicio" className="text-sm font-medium">Data início férias</label>
                <Input
                  id="admin-person-data-inicio"
                  type="date"
                  value={form.dataInicioFerias}
                  onChange={(event) => setForm((prev) => ({ ...prev, dataInicioFerias: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="admin-person-data-fim" className="text-sm font-medium">Data fim férias</label>
                <Input
                  id="admin-person-data-fim"
                  type="date"
                  value={form.dataFimFerias}
                  onChange={(event) => setForm((prev) => ({ ...prev, dataFimFerias: event.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={isPending} onClick={handleSave}>
                {isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
