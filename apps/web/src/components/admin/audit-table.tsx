'use client'

import { Fragment, useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AdminAuditLog, PerspectivaReatribuicaoAdmin30d } from '@/lib/types/database'

interface AuditTableProps {
  logs: AdminAuditLog[]
  perspectiva: PerspectivaReatribuicaoAdmin30d[]
}

const acaoLabels: Record<string, { label: string; color: string }> = {
  ativar_distribuicao: { label: 'Ativou distribuição', color: 'text-green-700 dark:text-green-300' },
  desativar_distribuicao: { label: 'Desativou distribuição', color: 'text-red-700 dark:text-red-300' },
  marcar_ferias: { label: 'Marcou férias', color: 'text-amber-700 dark:text-amber-300' },
  retornar_ferias: { label: 'Retornou de férias', color: 'text-green-700 dark:text-green-300' },
  alterar_max_notas: { label: 'Alterou limite de notas', color: 'text-blue-700 dark:text-blue-300' },
  ativar_admin: { label: 'Ativou admin', color: 'text-green-700 dark:text-green-300' },
  desativar_admin: { label: 'Desativou admin', color: 'text-red-700 dark:text-red-300' },
  reatribuir_nota: { label: 'Reatribuiu nota', color: 'text-indigo-700 dark:text-indigo-300' },
  reatribuir_lote: { label: 'Reatribuiu em lote', color: 'text-indigo-700 dark:text-indigo-300' },
}

export function AuditTable({ logs, perspectiva }: AuditTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (logs.length === 0 && perspectiva.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nenhum registro de auditoria encontrado.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {perspectiva.length > 0 && (
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-3">
            <h3 className="font-semibold text-sm">Perspectiva Administrativa (30 dias)</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="px-4 py-3 text-left font-medium">Administrador</th>
                <th className="px-4 py-3 text-left font-medium">Enviadas</th>
                <th className="px-4 py-3 text-left font-medium">Recebidas</th>
                <th className="px-4 py-3 text-left font-medium">Acompanhando abertas</th>
              </tr>
            </thead>
            <tbody>
              {perspectiva.map((row) => (
                <tr key={row.administrador_id} className="border-b">
                  <td className="px-4 py-3 font-medium">{row.nome}</td>
                  <td className="px-4 py-3">{row.qtd_enviadas_30d}</td>
                  <td className="px-4 py-3">{row.qtd_recebidas_30d}</td>
                  <td className="px-4 py-3">{row.qtd_ordens_acompanhando_abertas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium w-8" />
                <th className="px-4 py-3 text-left font-medium">Data/Hora</th>
                <th className="px-4 py-3 text-left font-medium">Gestor</th>
                <th className="px-4 py-3 text-left font-medium">Ação</th>
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
      )}
    </div>
  )
}
