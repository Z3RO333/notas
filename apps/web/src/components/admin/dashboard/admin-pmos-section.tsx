import { createClient } from '@/lib/supabase/server'
import { OrdersAgingTable } from '@/components/orders/orders-aging-table'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersRankingAdmin } from '@/components/orders/orders-ranking-admin'
import { OrdersRankingUnidade } from '@/components/orders/orders-ranking-unidade'
import type { AdminDashboardPeriod } from '@/lib/dashboard/period'
import {
  getOrdersCriticalityLevel,
  workspaceKpisToOrdemNotaKpis,
} from '@/lib/orders/metrics'
import type {
  OrdemNotaAcompanhamento,
  OrdemNotaKpis,
  OrdemNotaRankingAdmin,
  OrdemNotaRankingUnidade,
  OrderReassignTarget,
  OrdersWorkspaceKpis,
} from '@/lib/types/database'

interface AdminPmosSectionProps {
  period: AdminDashboardPeriod
  reassignTargets: OrderReassignTarget[]
}

function includesToken(haystack: string | null | undefined, token: string): boolean {
  return (haystack ?? '').toLowerCase().includes(token.toLowerCase())
}

function isRpcWithoutTipoOrdemSupport(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true

  return (
    includesToken(error.message, 'p_tipo_ordem')
    || includesToken(error.details, 'p_tipo_ordem')
    || includesToken(error.hint, 'p_tipo_ordem')
  )
}

async function callRpcWithOptionalTipoOrdem<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const withTipo = await supabase.rpc(rpcName, params)
  if (withTipo.error && isRpcWithoutTipoOrdemSupport(withTipo.error)) {
    const withoutTipoParams = { ...params }
    delete withoutTipoParams.p_tipo_ordem

    const fallback = await supabase.rpc(rpcName, withoutTipoParams)
    return {
      data: (fallback.data ?? null) as T | null,
      error: fallback.error ? { code: fallback.error.code, message: fallback.error.message } : null,
    }
  }

  return {
    data: (withTipo.data ?? null) as T | null,
    error: withTipo.error ? { code: withTipo.error.code, message: withTipo.error.message } : null,
  }
}

export async function AdminPmosSection({
  period,
  reassignTargets,
}: AdminPmosSectionProps) {
  const supabase = await createClient()

  const [
    orderKpisResult,
    ordensRowsResult,
    rankingAdminResult,
    rankingUnidadeResult,
  ] = await Promise.all([
    supabase.rpc('calcular_kpis_ordens_operacional', {
      p_period_mode: 'range',
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_year: null,
      p_month: null,
      p_status: null,
      p_unidade: null,
      p_responsavel: null,
      p_prioridade: null,
      p_q: null,
      p_admin_scope: null,
      p_tipo_ordem: 'PMOS',
    }),
    supabase.rpc('buscar_ordens_prioritarias_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_limit: 20,
      p_tipo_ordem: 'PMOS',
    }),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingAdmin[]>(
      supabase,
      'calcular_ranking_ordens_admin',
      {
        p_start_iso: period.startIso,
        p_end_exclusive_iso: period.endExclusiveIso,
        p_tipo_ordem: 'PMOS',
      }
    ),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingUnidade[]>(
      supabase,
      'calcular_ranking_ordens_unidade',
      {
        p_start_iso: period.startIso,
        p_end_exclusive_iso: period.endExclusiveIso,
        p_tipo_ordem: 'PMOS',
      }
    ),
  ])

  const firstError = [
    orderKpisResult.error,
    ordensRowsResult.error,
    rankingAdminResult.error,
    rankingUnidadeResult.error,
  ].find(Boolean)

  if (firstError) throw firstError

  const rawOrderKpis = (orderKpisResult.data ?? {}) as Partial<OrdersWorkspaceKpis>
  const orderKpis: OrdemNotaKpis = workspaceKpisToOrdemNotaKpis({
    total: Number(rawOrderKpis.total ?? 0),
    abertas: Number(rawOrderKpis.abertas ?? 0),
    em_tratativa: Number(rawOrderKpis.em_tratativa ?? 0),
    em_avaliacao: Number(rawOrderKpis.em_avaliacao ?? 0),
    concluidas: Number(rawOrderKpis.concluidas ?? 0),
    canceladas: Number(rawOrderKpis.canceladas ?? 0),
    avaliadas: Number(rawOrderKpis.avaliadas ?? 0),
    atrasadas: Number(rawOrderKpis.atrasadas ?? 0),
    sem_responsavel: Number(rawOrderKpis.sem_responsavel ?? 0),
  })
  const ordersCriticality = getOrdersCriticalityLevel(orderKpis.total_ordens_30d, orderKpis.qtd_antigas_7d_30d)
  const ordensRows = (ordensRowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  const rankingAdminRaw = (rankingAdminResult.data ?? []) as Partial<OrdemNotaRankingAdmin>[]
  const rankingUnidadeRaw = (rankingUnidadeResult.data ?? []) as Partial<OrdemNotaRankingUnidade>[]
  const rankingAdmin: OrdemNotaRankingAdmin[] = rankingAdminRaw.map((row) => ({
    administrador_id: row.administrador_id ?? '',
    nome: row.nome ?? 'Sem nome',
    qtd_ordens_30d: Number(row.qtd_ordens_30d ?? 0),
    qtd_abertas_30d: Number(row.qtd_abertas_30d ?? 0),
    qtd_em_tratativa_30d: Number(row.qtd_em_tratativa_30d ?? 0),
    qtd_concluidas_30d: Number(row.qtd_concluidas_30d ?? 0),
    qtd_canceladas_30d: Number(row.qtd_canceladas_30d ?? 0),
    qtd_antigas_7d_30d: Number(row.qtd_antigas_7d_30d ?? 0),
    tempo_medio_geracao_dias_30d: row.tempo_medio_geracao_dias_30d === null || row.tempo_medio_geracao_dias_30d === undefined
      ? null
      : Number(row.tempo_medio_geracao_dias_30d),
  }))
  const rankingUnidade: OrdemNotaRankingUnidade[] = rankingUnidadeRaw.map((row) => ({
    unidade: row.unidade ?? 'Sem unidade',
    qtd_ordens_30d: Number(row.qtd_ordens_30d ?? 0),
    qtd_abertas_30d: Number(row.qtd_abertas_30d ?? 0),
    qtd_em_tratativa_30d: Number(row.qtd_em_tratativa_30d ?? 0),
    qtd_antigas_7d_30d: Number(row.qtd_antigas_7d_30d ?? 0),
    tempo_medio_geracao_dias_30d: row.tempo_medio_geracao_dias_30d === null || row.tempo_medio_geracao_dias_30d === undefined
      ? null
      : Number(row.tempo_medio_geracao_dias_30d),
  }))

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Acompanhamento PMOS</h2>
          <p className="text-sm text-muted-foreground">
            Ordens de manutenção operacional (PMOS) no período selecionado.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Período: {period.periodLabel}
        </span>
      </div>

      <OrdersKpiStrip
        kpis={orderKpis}
        activeKpi={null}
        criticality={ordersCriticality}
        interactive={false}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <OrdersAgingTable
            rows={ordensRows}
            title={`Ordens PMOS acompanhadas (${period.periodLabel})`}
            maxRows={20}
            showAdminColumns
            canReassign
            reassignTargets={reassignTargets}
            currentUserRole="gestor"
          />
        </div>
        <OrdersRankingUnidade rows={rankingUnidade.slice(0, 12)} periodLabel={period.periodLabel} />
      </div>

      <OrdersRankingAdmin rows={rankingAdmin.slice(0, 12)} periodLabel={period.periodLabel} />
    </section>
  )
}
