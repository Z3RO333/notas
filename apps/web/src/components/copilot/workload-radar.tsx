'use client'

import { Avatar } from '@/components/ui/avatar'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { IsoMiniBadge } from '@/components/copilot/iso-gauge'
import { getWorkloadStatusConfig } from '@/lib/copilot/workload'
import type { WorkloadRadarRow } from '@/lib/types/copilot'

interface WorkloadRadarProps {
  rows: WorkloadRadarRow[]
}

export function WorkloadRadar({ rows }: WorkloadRadarProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Radar da Equipe</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum colaborador ativo.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Radar da Equipe</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <WorkloadRadarCard key={row.administrador_id} row={row} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function WorkloadRadarCard({ row }: { row: WorkloadRadarRow }) {
  const statusConfig = getWorkloadStatusConfig(row.workload_status)
  const pctCarga = Math.round(row.pct_carga)
  const barWidth = Math.min(pctCarga, 100)

  return (
    <div className={`rounded-lg border p-3 ${statusConfig.bg} ${statusConfig.border}`}>
      <div className="flex items-start gap-2.5">
        <Avatar nome={row.nome} src={row.avatar_url} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{row.nome}</span>
            {row.em_ferias && (
              <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">Férias</span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <IsoMiniBadge score={row.iso_score} faixa={row.iso_faixa} />
            <span className={`text-xs font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>
        </div>
      </div>

      {/* Barra de carga */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
          <span>Carga</span>
          <span className="font-medium">{row.qtd_abertas} abertas ({pctCarga}%)</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-background/60">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              pctCarga >= 90 ? 'bg-red-500' : pctCarga >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* Metricas inline */}
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        {row.qtd_notas_criticas > 0 && (
          <span className="text-red-600 font-medium">{row.qtd_notas_criticas} críticas</span>
        )}
        {row.qtd_ordens_vermelhas > 0 && (
          <span className="text-red-600 font-medium">{row.qtd_ordens_vermelhas} ordens atras.</span>
        )}
        <span>{row.concluidas_7d} conc./7d</span>
      </div>
    </div>
  )
}
