'use client'

import { Fragment, useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AdminAuditLog } from '@/lib/types/database'

interface AuditTableProps {
  logs: AdminAuditLog[]
}

const acaoLabels: Record<string, { label: string; color: string }> = {
  ativar_distribuicao: { label: 'Ativou distribuicao', color: 'text-green-700' },
  desativar_distribuicao: { label: 'Desativou distribuicao', color: 'text-red-700' },
  marcar_ferias: { label: 'Marcou ferias', color: 'text-amber-700' },
  retornar_ferias: { label: 'Retornou de ferias', color: 'text-green-700' },
  alterar_max_notas: { label: 'Alterou limite de notas', color: 'text-blue-700' },
  ativar_admin: { label: 'Ativou admin', color: 'text-green-700' },
  desativar_admin: { label: 'Desativou admin', color: 'text-red-700' },
}

export function AuditTable({ logs }: AuditTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nenhum registro de auditoria encontrado.
      </p>
    )
  }

  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium w-8" />
            <th className="px-4 py-3 text-left font-medium">Data/Hora</th>
            <th className="px-4 py-3 text-left font-medium">Gestor</th>
            <th className="px-4 py-3 text-left font-medium">Acao</th>
            <th className="px-4 py-3 text-left font-medium">Alvo</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => {
            const acaoConfig = acaoLabels[log.acao] ?? { label: log.acao, color: 'text-foreground' }
            const isExpanded = expandedId === log.id

            return (
              <Fragment key={log.id}>
                <tr
                  className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <td className="px-4 py-3">
                    {log.detalhes ? (
                      isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_at), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {log.gestor?.nome ?? '—'}
                  </td>
                  <td className={`px-4 py-3 font-medium ${acaoConfig.color}`}>
                    {acaoConfig.label}
                  </td>
                  <td className="px-4 py-3">
                    {log.alvo?.nome ?? '—'}
                  </td>
                </tr>
                {isExpanded && log.detalhes && (
                  <tr key={`${log.id}-details`} className="border-b bg-muted/20">
                    <td />
                    <td colSpan={4} className="px-4 py-3">
                      <pre className="text-xs text-muted-foreground bg-muted rounded p-3 overflow-x-auto">
                        {JSON.stringify(log.detalhes, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
