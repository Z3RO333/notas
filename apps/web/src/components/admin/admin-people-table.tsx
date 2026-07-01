'use client'

import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { AdminPerson, PersonFormState } from '@/components/admin/admin-people-types'
import {
  formatVacationPeriod,
  getEspecialidadeLabel,
  resolvePmplAssignment,
} from '@/components/admin/admin-people-utils'

interface AdminPeopleTableProps {
  people: AdminPerson[]
  isPending: boolean
  pmplResponsavelId?: string | null
  pmplSubstitutoId?: string | null
  onEdit: (person: AdminPerson) => void
  onQuickUpdate: (person: AdminPerson, patch: Partial<PersonFormState>) => void
  onToggleDistribuicao: (person: AdminPerson, value: boolean) => void
}

export function AdminPeopleTable({
  people,
  isPending,
  pmplResponsavelId = null,
  pmplSubstitutoId = null,
  onEdit,
  onQuickUpdate,
  onToggleDistribuicao,
}: AdminPeopleTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-3 py-2 text-left font-medium">Nome</th>
            <th className="px-3 py-2 text-left font-medium">Email</th>
            <th className="px-3 py-2 text-left font-medium">Cargo</th>
            <th className="px-3 py-2 text-left font-medium">Função</th>
            <th className="px-3 py-2 text-left font-medium">Ativo</th>
            <th className="px-3 py-2 text-left font-medium">Distribuição</th>
            <th className="px-3 py-2 text-left font-medium">Em férias</th>
            <th className="px-3 py-2 text-left font-medium">Período</th>
            <th className="px-3 py-2 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const assignment = resolvePmplAssignment({
              personId: person.id,
              pmplResponsavelId,
              pmplSubstitutoId,
            })

            return (
              <tr key={person.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{person.nome}</td>
                <td className="px-3 py-2 text-muted-foreground">{person.email}</td>
                <td className="px-3 py-2 uppercase">{person.role}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{getEspecialidadeLabel(person.especialidade)}</span>
                    {assignment === 'responsavel' && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                        PMPL Responsável
                      </span>
                    )}
                    {assignment === 'substituto' && (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
                        PMPL Substituto
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Switch
                    checked={person.ativo}
                    onCheckedChange={(checked) => onQuickUpdate(person, { ativo: checked })}
                    disabled={isPending}
                  />
                </td>
                <td className="px-3 py-2">
                  <Switch
                    checked={person.recebe_distribuicao}
                    onCheckedChange={(checked) => onToggleDistribuicao(person, checked)}
                    disabled={isPending || !person.ativo || person.role === 'gestor'}
                  />
                </td>
                <td className="px-3 py-2">
                  <Switch
                    checked={person.em_ferias}
                    onCheckedChange={(checked) => onQuickUpdate(person, { emFerias: checked })}
                    disabled={isPending}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatVacationPeriod(person)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => onEdit(person)} disabled={isPending}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Editar
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
