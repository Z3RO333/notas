'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { salvarPessoaAdmin, toggleDistribuicao } from '@/lib/actions/admin-actions'
import { AdminPersonDialog } from '@/components/admin/admin-person-dialog'
import { AdminPeopleTable } from '@/components/admin/admin-people-table'
import type {
  AdminPeopleManagerProps,
  AdminPerson,
  PersonFormState,
} from '@/components/admin/admin-people-types'
import {
  EMPTY_PERSON_FORM,
  toPersonFormState,
} from '@/components/admin/admin-people-utils'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { Especialidade } from '@/lib/types/database'

export function AdminPeopleManager({
  people,
  pmplResponsavelId = null,
  pmplSubstitutoId = null,
}: AdminPeopleManagerProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<PersonFormState>(EMPTY_PERSON_FORM)

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [people]
  )

  function openForCreate() {
    setForm(EMPTY_PERSON_FORM)
    setDialogOpen(true)
  }

  function openForEdit(person: AdminPerson) {
    setForm(toPersonFormState(person))
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
          especialidade: patch.especialidade ?? (person.especialidade as Especialidade) ?? 'geral',
          ativo: patch.ativo ?? person.ativo,
          emFerias: patch.emFerias ?? person.em_ferias,
          dataInicioFerias: patch.dataInicioFerias ?? person.data_inicio_ferias,
          dataFimFerias: patch.dataFimFerias ?? person.data_fim_ferias,
          emailsAdicionais: person.emailsAdicionais,
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

  function handleToggleDistribuicao(person: AdminPerson, value: boolean) {
    startTransition(async () => {
      try {
        await toggleDistribuicao(person.id, value)
        toast({ title: 'Distribuição atualizada', variant: 'success' })
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao atualizar distribuição',
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
          especialidade: form.especialidade,
          ativo: form.ativo,
          emFerias: form.emFerias,
          dataInicioFerias: form.dataInicioFerias || null,
          dataFimFerias: form.dataFimFerias || null,
          emailsAdicionais: form.emailsAdicionais,
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
            Cadastre e edite pessoas que podem atuar no modulo de ordens.
          </p>
        </div>
        <Button type="button" onClick={openForCreate} disabled={isPending}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar pessoa
        </Button>
      </div>

      <AdminPeopleTable
        people={sortedPeople}
        isPending={isPending}
        pmplResponsavelId={pmplResponsavelId}
        pmplSubstitutoId={pmplSubstitutoId}
        onEdit={openForEdit}
        onQuickUpdate={handleQuickUpdate}
        onToggleDistribuicao={handleToggleDistribuicao}
      />

      <AdminPersonDialog
        open={dialogOpen}
        isPending={isPending}
        form={form}
        pmplResponsavelId={pmplResponsavelId}
        pmplSubstitutoId={pmplSubstitutoId}
        onOpenChange={setDialogOpen}
        onFormChange={(next) => setForm((prev) => typeof next === 'function' ? next(prev) : next)}
        onSave={handleSave}
      />
    </div>
  )
}
