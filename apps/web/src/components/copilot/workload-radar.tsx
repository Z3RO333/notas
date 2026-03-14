'use client'

import { AlertTriangle, Clock3, Siren } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getWorkloadStatusConfig } from '@/lib/copilot/workload'
import { getIsoFaixaConfig } from '@/lib/copilot/iso'
import {
  resolveCargoPresentationFromEspecialidade,
} from '@/lib/collaborator/cargo-presentation'
import { cn } from '@/lib/utils'
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

const ISO_TEXT_CLASS: Record<string, string> = {
  critico: 'text-red-600',
  risco_alto: 'text-orange-600',
  atencao: 'text-amber-600',
  saudavel: 'text-emerald-600',
}

function WorkloadRadarCard({ row }: { row: WorkloadRadarRow }) {
  const cargo = resolveCargoPresentationFromEspecialidade(row.especialidade)
  const statusConfig = getWorkloadStatusConfig(row.workload_status)
  const isoConfig = getIsoFaixaConfig(row.iso_faixa)
  const isoTextClass = ISO_TEXT_CLASS[row.iso_faixa] ?? 'text-emerald-600'
  const pctCarga = Math.round(row.pct_carga)
  const barWidth = Math.min(pctCarga, 100)

  const barColor =
    pctCarga >= 90 ? 'bg-red-500' : pctCarga >= 70 ? 'bg-amber-500' : 'bg-emerald-500'

  const accentColor =
    pctCarga >= 90 ? 'bg-red-500' : pctCarga >= 70 ? 'bg-amber-400' : pctCarga >= 30 ? 'bg-emerald-500' : 'bg-sky-400'

  return (
    <div className={cn('rounded-xl border overflow-hidden bg-card shadow-sm', statusConfig.border)}>
      {/* Top accent strip */}
      <div className={cn('h-[3px]', accentColor)} />

      <div className="p-4 space-y-3">
        {/* Header: avatar + name + cargo + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar src={row.avatar_url} nome={row.nome} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate leading-tight">{row.nome}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
                {cargo.label}
                {row.em_ferias && (
                  <span className="ml-1.5 text-sky-600 font-semibold">· Férias</span>
                )}
              </p>
            </div>
          </div>
          <span className={cn('text-xs font-bold shrink-0', statusConfig.color)}>
            {statusConfig.label}
          </span>
        </div>

        {/* ISO + Notas abertas */}
        <div className="flex items-end justify-between">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn('text-3xl font-black tabular-nums leading-none', isoTextClass)}
            >
              {Math.round(row.iso_score)}
            </span>
            <div className="flex flex-col justify-end pb-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground leading-none">
                ISO
              </span>
              <span className={cn('text-[10px] font-semibold leading-none mt-0.5', isoConfig.color)}>
                {isoConfig.label}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold tabular-nums text-foreground leading-none">
              {row.qtd_abertas}
            </span>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">backlog total</p>
          </div>
        </div>

        {/* Stats inline row */}
        <div className="flex items-center gap-0 text-xs border rounded-lg overflow-hidden divide-x">
          <div className="flex flex-col items-center flex-1 py-1.5 px-1">
            <div className="flex items-center gap-1">
              <AlertTriangle className={cn('h-3 w-3 shrink-0', row.qtd_notas_criticas > 0 ? 'text-red-500' : 'text-muted-foreground')} />
              <span className={cn('font-bold', row.qtd_notas_criticas > 0 ? 'text-red-600' : 'text-muted-foreground')}>
                {row.qtd_notas_criticas}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground mt-0.5">críticas</span>
          </div>
          <div className="flex flex-col items-center flex-1 py-1.5 px-1">
            <div className="flex items-center gap-1">
              <Siren className={cn('h-3 w-3 shrink-0', row.qtd_ordens_vermelhas > 0 ? 'text-red-500' : 'text-muted-foreground')} />
              <span className={cn('font-bold', row.qtd_ordens_vermelhas > 0 ? 'text-red-600' : 'text-muted-foreground')}>
                {row.qtd_ordens_vermelhas}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground mt-0.5">ordens atras.</span>
          </div>
          <div className="flex flex-col items-center flex-1 py-1.5 px-1">
            <div className="flex items-center gap-1">
              <Clock3 className={cn('h-3 w-3 shrink-0', row.concluidas_7d > 0 ? 'text-emerald-500' : 'text-muted-foreground')} />
              <span className={cn('font-bold', row.concluidas_7d > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
                {row.concluidas_7d}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground mt-0.5">conc./7d</span>
          </div>
        </div>

        {/* Carga bar */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Carga</span>
            <span className="font-semibold">{pctCarga}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barColor)}
              // eslint-disable-next-line react/forbid-component-props
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
