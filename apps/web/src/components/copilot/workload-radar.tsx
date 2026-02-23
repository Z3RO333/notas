'use client'

import { AlertTriangle, Clock3, FolderKanban, Siren } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IsoMiniBadge } from '@/components/copilot/iso-gauge'
import {
  resolveCargoPresentationFromEspecialidade,
} from '@/lib/collaborator/cargo-presentation'
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
  const cargo = resolveCargoPresentationFromEspecialidade(row.especialidade)
  const statusConfig = getWorkloadStatusConfig(row.workload_status)
  const pctCarga = Math.round(row.pct_carga)
  const barWidth = Math.min(pctCarga, 100)

  return (
    <CollaboratorCardShell
      variant="compact"
      name={row.nome}
      avatarUrl={row.avatar_url}
      cargo={cargo}
      className={`${statusConfig.bg} ${statusConfig.border}`}
      statusBadges={row.em_ferias ? (
        <span className="inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
          Férias
        </span>
      ) : null}
      headerRight={(
        <span className={`text-xs font-semibold ${statusConfig.color}`}>
          {statusConfig.label}
        </span>
      )}
      topSlot={(
        <div className="flex items-center gap-2">
          <IsoMiniBadge score={row.iso_score} faixa={row.iso_faixa} />
          <span className="text-[11px] text-muted-foreground">ISO operacional</span>
        </div>
      )}
      primaryMetric={{
        id: 'abertas',
        label: 'Notas abertas',
        value: row.qtd_abertas,
        tone: 'info',
        icon: FolderKanban,
      }}
      secondaryMetrics={[
        {
          id: 'criticas',
          label: 'Críticas',
          value: row.qtd_notas_criticas,
          tone: row.qtd_notas_criticas > 0 ? 'danger' : 'neutral',
          icon: AlertTriangle,
        },
        {
          id: 'ordens-atrasadas',
          label: 'Ordens atras.',
          value: row.qtd_ordens_vermelhas,
          tone: row.qtd_ordens_vermelhas > 0 ? 'danger' : 'neutral',
          icon: Siren,
        },
        {
          id: 'concluidas-7d',
          label: 'Conc./7d',
          value: row.concluidas_7d,
          tone: 'success',
          icon: Clock3,
        },
      ]}
      details={(
        <div className="space-y-1.5">
          <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Carga</span>
            <span className="font-medium">{pctCarga}%</span>
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
      )}
    />
  )
}
