'use client'

import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Avatar } from '@/components/ui/avatar'
import type {
  OperacionalAdmin,
  OperacionalFormState,
} from '@/components/admin/operacional/admin-operacionais-types'

interface AdminOperacionaisTableProps {
  operacionais: OperacionalAdmin[]
  isPending: boolean
  onEdit: (op: OperacionalAdmin) => void
  onQuickUpdate: (op: OperacionalAdmin, patch: Partial<OperacionalFormState>) => void
}

export function AdminOperacionaisTable({
  operacionais,
  isPending,
  onEdit,
  onQuickUpdate,
}: AdminOperacionaisTableProps) {
  if (operacionais.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nenhum operacional cadastrado.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-3 py-2 text-left font-medium">Nome</th>
            <th className="px-3 py-2 text-left font-medium">Código</th>
            <th className="px-3 py-2 text-left font-medium">Especialidade</th>
            <th className="px-3 py-2 text-left font-medium">Lojas</th>
            <th className="px-3 py-2 text-left font-medium">Ativo</th>
            <th className="px-3 py-2 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {operacionais.map((op) => (
            <tr key={op.codigo} className="border-b last:border-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Avatar src={op.avatar_url} nome={op.nome} size="sm" />
                  <span className="font-medium">{op.nome}</span>
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{op.codigo}</td>
              <td className="px-3 py-2 text-muted-foreground">{op.especialidade ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {op.unidades.length > 0
                  ? `${op.unidades.length} ${op.unidades.length === 1 ? 'loja' : 'lojas'}`
                  : '—'}
              </td>
              <td className="px-3 py-2">
                <Switch
                  checked={op.ativo}
                  disabled={isPending}
                  onCheckedChange={(checked) => onQuickUpdate(op, { ativo: checked })}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  onClick={() => onEdit(op)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
