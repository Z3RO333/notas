import { useRef, useEffect, useMemo } from 'react'
import { AlertTriangle, ClipboardList, Clock, Send, CheckCircle } from 'lucide-react'
import { NotaCard } from '@/components/painel/nota-card'
import { AdminSummary } from '@/components/painel/admin-summary'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData } from '@/lib/types/database'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

interface NotaGroup {
  key: string
  label: string
  icon: typeof AlertTriangle
  color: string
  notas: NotaPanelData[]
}

interface CollaboratorAccordionProps {
  collaborator: CollaboratorData
  notas: NotaPanelData[]
  isOpen: boolean
  adminActions?: React.ReactNode
}

export function CollaboratorAccordion({
  collaborator,
  notas,
  isOpen,
  adminActions,
}: CollaboratorAccordionProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && ref.current) {
      const timer = setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const groups = useMemo(() => {
    const now = Date.now()
    const aging: NotaPanelData[] = []
    const novas: NotaPanelData[] = []
    const emAndamento: NotaPanelData[] = []
    const encaminhadas: NotaPanelData[] = []
    const concluidas: NotaPanelData[] = []

    for (const nota of notas) {
      if (nota.status === 'concluida') {
        concluidas.push(nota)
        continue
      }

      // Check if > 24h (only for open notes)
      const created = nota.data_criacao_sap ? new Date(nota.data_criacao_sap).getTime() : 0
      const isAging = created > 0 && now - created > ONE_DAY_MS

      if (isAging) {
        aging.push(nota)
      } else if (nota.status === 'nova') {
        novas.push(nota)
      } else if (nota.status === 'em_andamento') {
        emAndamento.push(nota)
      } else if (nota.status === 'encaminhada_fornecedor') {
        encaminhadas.push(nota)
      } else {
        novas.push(nota)
      }
    }

    const result: NotaGroup[] = [
      { key: 'aging', label: 'Em atraso (> 24h)', icon: AlertTriangle, color: 'text-red-600 border-red-200 bg-red-50', notas: aging },
      { key: 'nova', label: 'Novas', icon: ClipboardList, color: 'text-blue-600 border-blue-200 bg-blue-50', notas: novas },
      { key: 'em_andamento', label: 'Em Andamento', icon: Clock, color: 'text-amber-600 border-amber-200 bg-amber-50', notas: emAndamento },
      { key: 'encaminhada', label: 'Encaminhadas', icon: Send, color: 'text-purple-600 border-purple-200 bg-purple-50', notas: encaminhadas },
      { key: 'concluida', label: 'Concluidas', icon: CheckCircle, color: 'text-green-600 border-green-200 bg-green-50', notas: concluidas },
    ]

    return result.filter((g) => g.notas.length > 0)
  }, [notas])

  return (
    <div
      ref={ref}
      className="accordion-grid"
      data-state={isOpen ? 'open' : 'closed'}
    >
      <div className="accordion-content">
        <div className="rounded-lg border bg-card p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-base">{collaborator.nome}</h3>
            <span className="text-sm text-muted-foreground">
              {notas.length} nota{notas.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Admin actions slot */}
          {adminActions && (
            <div className="border-b pb-4">
              {adminActions}
            </div>
          )}

          {/* Summary pills */}
          <AdminSummary notas={notas} />

          {/* Grouped notes */}
          {notas.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma nota encontrada
              </p>
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto pr-1 space-y-4">
              {groups.map((group) => {
                const Icon = group.icon
                return (
                  <div key={group.key}>
                    <div className={`flex items-center gap-2 mb-2 rounded-md border px-3 py-1.5 text-xs font-semibold ${group.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                      <span>{group.label}</span>
                      <span className="ml-auto font-bold">{group.notas.length}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {group.notas.map((nota) => (
                        <NotaCard key={nota.id} nota={nota} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
