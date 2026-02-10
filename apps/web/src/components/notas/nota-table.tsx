'use client'

import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { NotaStatusBadge } from './nota-status-badge'
import type { NotaManutencao } from '@/lib/types/database'

interface NotaTableProps {
  notas: NotaManutencao[]
}

const prioridadeLabel: Record<string, string> = {
  '1': 'Muito Alta',
  '2': 'Alta',
  '3': 'Media',
  '4': 'Baixa',
}

export function NotaTable({ notas }: NotaTableProps) {
  const router = useRouter()

  if (notas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          Nenhuma nota encontrada
        </p>
        <p className="text-sm text-muted-foreground">
          Novas notas aparecerao aqui automaticamente
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Nota</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Descricao</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Centro</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Prioridade</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Solicitante</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Data</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {notas.map((nota) => (
            <tr
              key={nota.id}
              className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
              onClick={() => router.push(`/admin/notas/${nota.id}`)}
            >
              <td className="px-4 py-3 text-sm font-mono font-medium">
                {nota.numero_nota}
              </td>
              <td className="px-4 py-3 text-sm max-w-xs truncate">
                {nota.descricao}
              </td>
              <td className="px-4 py-3 text-sm">
                {nota.centro || '-'}
              </td>
              <td className="px-4 py-3 text-sm">
                {nota.prioridade ? (prioridadeLabel[nota.prioridade] || nota.prioridade) : '-'}
              </td>
              <td className="px-4 py-3 text-sm">
                {nota.solicitante || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {nota.data_criacao_sap
                  ? format(new Date(nota.data_criacao_sap), 'dd/MM/yyyy')
                  : '-'}
              </td>
              <td className="px-4 py-3">
                <NotaStatusBadge status={nota.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
