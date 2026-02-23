'use client'

import { ArrowDown, ArrowUp, CheckCircle2, Clock3, Gauge, Minus } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  resolveCargoPresentationFromEspecialidade,
} from '@/lib/collaborator/cargo-presentation'
import { getMedalConfig, getTendenciaConfig } from '@/lib/copilot/productivity'
import type { ProductivityDetailRow } from '@/lib/types/copilot'

interface ProductivityMedalsProps {
  rows: ProductivityDetailRow[]
}

export function ProductivityMedals({ rows }: ProductivityMedalsProps) {
  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ranking de Produtividade</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <ProductivityRow key={row.administrador_id} row={row} rank={i + 1} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ProductivityRow({ row, rank }: { row: ProductivityDetailRow; rank: number }) {
  const cargo = resolveCargoPresentationFromEspecialidade(row.especialidade)
  const medalConfig = getMedalConfig(row.medal)
  const tendenciaConfig = getTendenciaConfig(row.tendencia)
  const TendenciaIcon = row.tendencia === 'subindo' ? ArrowUp : row.tendencia === 'caindo' ? ArrowDown : Minus

  return (
    <CollaboratorCardShell
      variant="compact"
      name={row.nome}
      avatarUrl={row.avatar_url}
      cargo={cargo}
      statusBadges={(
        <>
          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            #{rank}
          </span>
          {medalConfig && (
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${medalConfig.bg} ${medalConfig.color}`}>
              {medalConfig.label}
            </span>
          )}
        </>
      )}
      headerRight={(
        <span className={`inline-flex items-center gap-0.5 text-xs ${tendenciaConfig.color}`}>
          <TendenciaIcon className="h-3 w-3" />
          {row.variacao_pct > 0 ? '+' : ''}{row.variacao_pct.toFixed(0)}%
        </span>
      )}
      primaryMetric={{
        id: 'concluidas-30d',
        label: 'Concluídas / 30d',
        value: row.concluidas_30d,
        tone: 'success',
        icon: CheckCircle2,
      }}
      secondaryMetrics={[
        {
          id: 'concluidas-7d',
          label: 'Concl./7d',
          value: row.concluidas_7d,
          tone: 'info',
          icon: Clock3,
        },
        {
          id: 'eficiencia',
          label: 'Eficiência',
          value: `${(row.eficiencia * 100).toFixed(0)}%`,
          tone: 'neutral',
          icon: Gauge,
        },
      ]}
    />
  )
}
