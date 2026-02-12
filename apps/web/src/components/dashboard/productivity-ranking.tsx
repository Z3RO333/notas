import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, Minus, Trophy } from 'lucide-react'
import type { ComponentType } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getEspecialidadeLabel } from '@/lib/dashboard/metrics'
import type { DashboardProductivityRow } from '@/lib/types/dashboard'

interface ProductivityRankingProps {
  rows: DashboardProductivityRow[]
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

export function ProductivityRanking({ rows }: ProductivityRankingProps) {
  const topRows = rows.slice(0, 8)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Produtividade individual (30d)</CardTitle>
        <Link href="/admin/distribuicao" className="text-sm font-medium text-primary hover:underline">
          Ver distribuicao
        </Link>
      </CardHeader>
      <CardContent>
        {topRows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Sem dados de produtividade para exibir.
          </div>
        ) : (
          <div className="space-y-3">
            {topRows.map((row, index) => {
              const variation = getVariationStyle(row.variacao_30d)
              const VariationIcon = variation.icon
              const isTop = index === 0 && row.concluidas_30d > 0

              return (
                <div key={row.administrador_id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {index + 1}
                    </div>
                    <div className="relative">
                      <Avatar src={row.avatar_url} nome={row.nome} size="md" />
                      {isTop && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-yellow-400 p-0.5">
                          <Trophy className="h-3 w-3 text-yellow-900" />
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">{row.nome}</p>
                      <p className="text-xs text-muted-foreground">{getEspecialidadeLabel(row.especialidade)}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xl font-bold text-green-700">{row.concluidas_30d}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${variation.tone}`}>
                      <VariationIcon className="h-3 w-3" />
                      {variation.text}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
