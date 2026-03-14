import type { CopilotAlert } from '@/lib/types/copilot'
import type { IsoAdminRow, IsoGlobal } from '@/lib/types/copilot'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'
import type { SyncLog } from '@/lib/types/database'

const SYNC_STALE_MINUTES = 60

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
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
  notasCriticas: number
  now?: Date
}): CopilotAlert[] {
  const { isoGlobal, isoAdmins, summary, latestSync, notasCriticas } = params
  const now = params.now ?? new Date()
  const nowMs = now.getTime()
  const alerts: CopilotAlert[] = []

  // 1. ISO global crítico
  if (isoGlobal.iso_faixa === 'critico') {
    alerts.push({
      id: 'iso-critico',
      level: 'critical',
      title: 'ISO crítico',
      description: `Índice de severidade operacional em ${isoGlobal.iso_score.toFixed(0)} — operação em estado crítico.`,
    })
  } else if (isoGlobal.iso_faixa === 'risco_alto') {
    alerts.push({
      id: 'iso-risco',
      level: 'warning',
      title: 'ISO em risco',
      description: `Índice de severidade operacional em ${isoGlobal.iso_score.toFixed(0)} — requer atenção.`,
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
        description: `ISO ${admin.iso_score.toFixed(0)} — ${admin.qtd_abertas} notas abertas, ${admin.qtd_notas_criticas} críticas.`,
        adminId: admin.administrador_id,
        adminNome: admin.nome,
        actionLabel: 'Ver notas',
        actionType: 'redistribuir',
        viewHref: `/?status=abertas&responsavel=${admin.administrador_id}`,
      })
    }
  }

  // 3. Notas com SLA estourado (5+ dias)
  if (notasCriticas > 0) {
    alerts.push({
      id: 'notas-estourado-sla',
      level: 'critical',
      title: 'Notas em SLA crítico',
      description: `${formatInteger(notasCriticas)} nota(s) aberta(s) há 5+ dias sem resolução.`,
      viewHref: '/?kpi=critico',
    })
  }

  // 4. Notas sem atribuição
  if (summary.sem_atribuir > 0) {
    alerts.push({
      id: 'sem-atribuir',
      level: 'critical',
      title: 'Notas sem atribuição',
      description: `${formatInteger(summary.sem_atribuir)} nota(s) nova(s) aguardando distribuição.`,
      viewHref: '/?status=nova&responsavel=sem_atribuir',
    })
  }

  // 5. Sync health
  if (!latestSync) {
    alerts.push({
      id: 'sync-ausente',
      level: 'critical',
      title: 'Sem histórico de sync',
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

  // 6. Sobrecarga relativa da equipe (workload_pressure é LEAST(..., 100) no SQL)
  const adminsSobrecarregados = isoAdmins.filter((a) => a.workload_pressure >= 90)
  if (adminsSobrecarregados.length > 0) {
    alerts.push({
      id: 'sobrecarga-equipe',
      level: 'warning',
      title: 'Sobrecarga na equipe',
      description: `${adminsSobrecarregados.length} colaborador(es) com pressao relativa elevada: ${adminsSobrecarregados.slice(0, 3).map((a) => `${a.nome} (${a.workload_pressure.toFixed(0)}%)`).join(', ')}.`,
    })
  }

  // 7. Backlog envelhecido
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
      title: 'Operação estável',
      description: 'Nenhum alerta crítico ou de aviso no momento.',
    })
  }

  return alerts
}
