import { describe, expect, it } from 'vitest'
import { buildAlerts } from '@/lib/dashboard/metrics'
import type { SyncHealthRow, SyncLog } from '@/lib/types/database'
import type { DashboardSummaryMetrics } from '@/lib/types/dashboard'

const summary: DashboardSummaryMetrics = {
  abertas_agora: 0,
  sem_atribuir: 0,
  aging_48h: 0,
  entradas_30d: 0,
  concluidas_30d: 0,
  notas_convertidas_30d: 0,
  taxa_nota_ordem_30d: 0,
  taxa_fechamento_30d: 0,
}

const latestSync: SyncLog = {
  id: 'sync-1',
  started_at: '2026-06-30T12:00:00.000Z',
  finished_at: '2026-06-30T12:01:00.000Z',
  status: 'success',
  notas_lidas: 1,
  notas_inseridas: 0,
  notas_atualizadas: 1,
  notas_distribuidas: 0,
  erro_mensagem: null,
  databricks_job_id: null,
  metadata: null,
}

function makeSyncHealth(overrides: Partial<SyncHealthRow>): SyncHealthRow {
  return {
    sync_id: 'sync-1',
    job_name: 'fast',
    started_at: '2026-06-30T12:00:00.000Z',
    finished_at: '2026-06-30T12:01:00.000Z',
    status: 'success',
    health_status: 'ok',
    health_reason: 'Sync saudavel.',
    health_rank: 0,
    minutes_since_last_event: 5,
    runtime_minutes: 1,
    warning_after_minutes: 10,
    critical_after_minutes: 20,
    notas_lidas: 1,
    notas_inseridas: 0,
    notas_atualizadas: 1,
    notas_distribuidas: 0,
    source_total_rows: 100,
    source_rows_read: 1,
    processing_duration_ms: 1000,
    internal_error_count: 0,
    internal_error_keys: [],
    erro_mensagem: null,
    databricks_job_id: null,
    metadata: null,
    ...overrides,
  }
}

describe('buildAlerts sync health', () => {
  it('uses critical database health as the sync alert source', () => {
    const alerts = buildAlerts({
      summary,
      latestSync,
      syncHealth: makeSyncHealth({
        health_status: 'critical',
        health_reason: 'Fonte primaria do fast sync retornou zero linhas.',
        health_rank: 2,
      }),
      now: new Date('2026-06-30T12:05:00.000Z'),
    })

    expect(alerts).toContainEqual({
      id: 'sync-critico',
      level: 'critical',
      title: 'Saude do sync em risco',
      description: 'Fonte primaria do fast sync retornou zero linhas.',
    })
  })

  it('uses warning database health without raising a critical stale fallback', () => {
    const alerts = buildAlerts({
      summary,
      latestSync,
      syncHealth: makeSyncHealth({
        health_status: 'warning',
        health_reason: 'Sync concluiu com falha interna tolerada.',
        health_rank: 1,
        internal_error_count: 1,
      }),
      now: new Date('2026-06-30T15:00:00.000Z'),
    })

    expect(alerts.some((alert) => alert.id === 'sync-critico')).toBe(false)
    expect(alerts).toContainEqual({
      id: 'sync-aviso',
      level: 'warning',
      title: 'Sync precisa de atencao',
      description: 'Sync concluiu com falha interna tolerada.',
    })
  })
})
