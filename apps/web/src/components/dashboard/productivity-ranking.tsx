import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, History, Minus, Trophy } from 'lucide-react'
import type { ComponentType } from 'react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { resolveCargoPresentationFromEspecialidade } from '@/lib/collaborator/cargo-presentation'
import type { DashboardProductivityRow } from '@/lib/types/dashboard'

interface ProductivityRankingProps {
  rows: DashboardProductivityRow[]
  periodLabel?: string
}

function getVariationStyle(value: number): { icon: ComponentType<{ className?: string }>; tone: string; text: string } {
  if (value > 0) {
    return {
      icon: ArrowUpRight,
      tone: 'text-green-700 bg-green-50',
      text: `+${value}`,
    }
  }
  if (value < 0) {
    return {
      icon: ArrowDownRight,
      tone: 'text-red-700 bg-red-50',
      text: String(value),
    }
  }
  return {
    icon: Minus,
    tone: 'text-muted-foreground bg-muted/60',
    text: '0',
  }
}

export function ProductivityRanking({ rows, periodLabel = '30d' }: ProductivityRankingProps) {
  const topRows = rows.slice(0, 8)

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">Produtividade individual ({periodLabel})</p>
        <Link href="/admin/pessoas" className="text-sm font-medium text-primary hover:underline">
          Ver pessoas
        </Link>
      </div>

      {topRows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sem dados de produtividade para exibir.
        </div>
      ) : (
        <div className="space-y-2.5">
          {topRows.map((row, index) => {
            const variation = getVariationStyle(row.variacao_30d)
            const VariationIcon = variation.icon
            const isTop = index === 0 && row.concluidas_30d > 0
            const cargo = resolveCargoPresentationFromEspecialidade(row.especialidade)

            return (
              <CollaboratorCardShell
                key={row.administrador_id}
                variant="compact"
                name={row.nome}
                avatarUrl={row.avatar_url}
                cargo={cargo}
                statusBadges={(
                  <>
                    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      #{index + 1}
                    </span>
                    {isTop && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-800">
                        <Trophy className="h-3 w-3" />
                        Top 1
                      </span>
                    )}
                  </>
                )}
                headerRight={(
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${variation.tone}`}>
                    <VariationIcon className="h-3 w-3" />
                    {variation.text}
                  </span>
                )}
                primaryMetric={{
                  id: 'concluidas-atual',
                  label: `Concluídas (${periodLabel})`,
                  value: row.concluidas_30d,
                  tone: 'success',
                  icon: CheckCircle2,
                }}
                secondaryMetrics={[
                  {
                    id: 'concluidas-prev',
                    label: 'Período anterior',
                    value: row.concluidas_prev_30d,
                    tone: 'neutral',
                    icon: History,
                  },
                ]}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
