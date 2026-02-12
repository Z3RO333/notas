'use client'

import { Avatar } from '@/components/ui/avatar'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { getMedalConfig, getTendenciaConfig } from '@/lib/copilot/productivity'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
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
  const medalConfig = getMedalConfig(row.medal)
  const tendenciaConfig = getTendenciaConfig(row.tendencia)
  const TendenciaIcon = row.tendencia === 'subindo' ? ArrowUp : row.tendencia === 'caindo' ? ArrowDown : Minus

  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5">
      {/* Rank / Medal */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">
        {medalConfig ? (
          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${medalConfig.bg} ${medalConfig.color}`}>
            {medalConfig.emoji}
          </span>
        ) : (
          <span className="text-muted-foreground">{rank}</span>
        )}
      </div>

      <Avatar nome={row.nome} src={row.avatar_url} size="sm" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{row.nome}</span>
          <span className={`flex items-center gap-0.5 text-xs ${tendenciaConfig.color}`}>
            <TendenciaIcon className="h-3 w-3" />
            {row.variacao_pct > 0 ? '+' : ''}{row.variacao_pct.toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span>{row.concluidas_30d} conc./30d</span>
          <span>{row.concluidas_7d} conc./7d</span>
          <span>Efic. {(row.eficiencia * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="text-right shrink-0">
        <span className="text-lg font-bold">{row.concluidas_30d}</span>
        <p className="text-[10px] text-muted-foreground">30 dias</p>
      </div>
    </div>
  )
}
