import type { CopilotAlert } from '@/lib/types/copilot'
import type { IsoAdminRow, IsoGlobal } from '@/lib/types/copilot'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'
import type { SyncLog } from '@/lib/types/database'

const SYNC_STALE_MINUTES = 60

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/**
 * Build expanded copilot alerts.
 * Includes the original dashboard alerts plus new ISO-based and SLA-based alerts.
 */
export function buildCopilotAlerts(params: {
  isoGlobal: IsoGlobal
  isoAdmins: IsoAdminRow[]
  summary: DashboardSummaryMetrics
  latestSync: SyncLog | null
  notasCriticas5d: number
  now?: Date
}): CopilotAlert[] {
  const { isoGlobal, isoAdmins, summary, latestSync, notasCriticas5d } = params
  const now = params.now ?? new Date()
  const nowMs = now.getTime()
  const alerts: CopilotAlert[] = []

  // 1. ISO global critico
  if (isoGlobal.iso_faixa === 'critico') {
    alerts.push({
      id: 'iso-critico',
      level: 'critical',
      title: 'ISO critico',
      description: `Indice de severidade operacional em ${isoGlobal.iso_score.toFixed(0)} — operacao em estado critico.`,
    })
  } else if (isoGlobal.iso_faixa === 'risco_alto') {
    alerts.push({
      id: 'iso-risco',
      level: 'warning',
      title: 'ISO em risco',
      description: `Indice de severidade operacional em ${isoGlobal.iso_score.toFixed(0)} — requer atencao.`,
    })
  }

  // 2. Admins sobrecarregados (ISO individual >= 75)
  const adminsCriticos = isoAdmins.filter((a) => a.iso_score >= 75)
  if (adminsCriticos.length > 0) {
    for (const admin of adminsCriticos.slice(0, 3)) {
      alerts.push({
        id: `admin-sobrecarregado-${admin.administrador_id}`,
        level: 'critical',
        title: `${admin.nome} sobrecarregado`,
        description: `ISO ${admin.iso_score.toFixed(0)} — ${admin.qtd_abertas} notas abertas, ${admin.qtd_notas_criticas} criticas.`,
        adminId: admin.administrador_id,
        adminNome: admin.nome,
        actionLabel: 'Redistribuir notas',
        actionType: 'redistribuir',
      })
    }
  }

  // 3. Notas com SLA estourado (5+ dias)
  if (notasCriticas5d > 0) {
    alerts.push({
      id: 'notas-estourado-sla',
      level: 'critical',
      title: 'Notas em SLA critico',
      description: `${formatInteger(notasCriticas5d)} nota(s) aberta(s) ha 5+ dias sem resolucao.`,
    })
  }

  // 4. Notas sem atribuicao
  if (summary.sem_atribuir > 0) {
    alerts.push({
      id: 'sem-atribuir',
      level: 'critical',
      title: 'Notas sem atribuicao',
      description: `${formatInteger(summary.sem_atribuir)} nota(s) nova(s) aguardando distribuicao.`,
    })
  }

  // 5. Sync health
  if (!latestSync) {
    alerts.push({
      id: 'sync-ausente',
      level: 'critical',
      title: 'Sem historico de sync',
      description: 'Nenhum sync encontrado no sistema.',
    })
  } else {
    const startedAtMs = Date.parse(latestSync.started_at)
    const isSyncError = latestSync.status === 'error'
    const minutesSinceSync = Number.isFinite(startedAtMs)
      ? Math.round((nowMs - startedAtMs) / (60 * 1000))
      : Number.POSITIVE_INFINITY
    const isStale = minutesSinceSync > SYNC_STALE_MINUTES

    if (isSyncError || isStale) {
      alerts.push({
        id: 'sync-critico',
        level: 'critical',
        title: 'Saude do sync em risco',
        description: isSyncError
          ? 'Ultimo sync retornou erro.'
          : `Ultimo sync ha ${minutesSinceSync} min (limite ${SYNC_STALE_MINUTES} min).`,
      })
    }
  }

  // 6. Capacidade limite (admin individual com carga >= 90%)
  const adminsLimite = isoAdmins.filter(
    (a) => a.max_notas > 0 && a.qtd_abertas / a.max_notas >= 0.9
  )
  if (adminsLimite.length > 0) {
    alerts.push({
      id: 'capacidade-limite',
      level: 'warning',
      title: 'Capacidade no limite',
      description: `${adminsLimite.length} colaborador(es) com carga >= 90%: ${adminsLimite.slice(0, 3).map((a) => `${a.nome} (${formatPercent(a.qtd_abertas / a.max_notas)})`).join(', ')}.`,
    })
  }

  // 7. Capacidade global elevada
  if (summary.utilizacao_capacidade >= 0.85 && adminsLimite.length === 0) {
    alerts.push({
      id: 'capacidade-global',
      level: 'warning',
      title: 'Capacidade elevada',
      description: `Utilizacao global em ${formatPercent(summary.utilizacao_capacidade)}.`,
    })
  }

  // 8. Backlog envelhecido
  if (summary.aging_48h >= 10) {
    alerts.push({
      id: 'aging',
      level: 'warning',
      title: 'Backlog envelhecido',
      description: `${formatInteger(summary.aging_48h)} nota(s) aberta(s) acima de 48h.`,
    })
  }

  // Fallback
  if (alerts.length === 0) {
    alerts.push({
      id: 'saudavel',
      level: 'info',
      title: 'Operacao estavel',
      description: 'Nenhum alerta critico ou de aviso no momento.',
    })
  }

  return alerts
}
