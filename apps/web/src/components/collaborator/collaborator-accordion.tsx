import Link from 'next/link'
import { useEffect, useMemo, useRef } from 'react'
import { ListChecks, LayoutGrid } from 'lucide-react'
import { NotaCard } from '@/components/painel/nota-card'
import { NotaListItem } from '@/components/painel/nota-list-item'
import { AdminSummary } from '@/components/painel/admin-summary'
import { getAgingDays, isOpenStatus } from '@/lib/collaborator/aging'
import type { CollaboratorData, NotesViewMode } from '@/lib/types/collaborator'
import type { NotaPanelData, OrdemAcompanhamento } from '@/lib/types/database'

interface CollaboratorAccordionProps {
  collaborator: CollaboratorData
  notas: NotaPanelData[]
  isOpen: boolean
  viewMode: NotesViewMode
  adminActions?: React.ReactNode
  trackingOrders?: OrdemAcompanhamento[]
}

function sortNotas(notas: NotaPanelData[]): NotaPanelData[] {
  return [...notas].sort((a, b) => {
    const aOpen = isOpenStatus(a.status) ? 1 : 0
    const bOpen = isOpenStatus(b.status) ? 1 : 0
    if (aOpen !== bOpen) return bOpen - aOpen

    const byAging = getAgingDays(b) - getAgingDays(a)
    if (byAging !== 0) return byAging
    return a.numero_nota.localeCompare(b.numero_nota)
  })
}

export function CollaboratorAccordion({
  collaborator,
  notas,
  isOpen,
  viewMode,
  adminActions,
  trackingOrders,
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

  const sortedNotas = useMemo(() => sortNotas(notas), [notas])

  return (
    <div ref={ref} className="accordion-grid" data-state={isOpen ? 'open' : 'closed'}>
      <div className="accordion-content">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-base">{collaborator.nome}</h3>
            <span className="text-sm text-muted-foreground">
              {notas.length} nota{notas.length !== 1 ? 's' : ''}
            </span>
          </div>

          {adminActions && <div className="border-b pb-4">{adminActions}</div>}

          <AdminSummary notas={notas} />

          {notas.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma nota encontrada</p>
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto pr-1">
              {viewMode === 'list' ? (
                <div className="space-y-2">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <ListChecks className="h-3.5 w-3.5" />
                    Lista vertical por prioridade de atraso
                  </div>
                  {sortedNotas.map((nota) => (
                    <NotaListItem key={nota.id} nota={nota} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Visualização em cards
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedNotas.map((nota) => (
                      <NotaCard key={nota.id} nota={nota} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {trackingOrders && trackingOrders.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground">Ordens em acompanhamento</p>
              {trackingOrders.slice(0, 6).map((order) => (
                <Link
                  key={order.acompanhamento_id}
                  href={`/notas/${order.nota_id}`}
                  className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted/50"
                >
                  <span className="font-mono">#{order.numero_nota}</span>
                  <span className="text-muted-foreground">Ordem {order.ordem_gerada}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
