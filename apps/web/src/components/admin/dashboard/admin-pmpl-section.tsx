import { createAdminClient } from '@/lib/supabase/admin'
import { OrdersAgingTable } from '@/components/orders/orders-aging-table'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import type { AdminDashboardPeriod } from '@/lib/dashboard/period'
import {
  getOrdersCriticalityLevel,
  workspaceKpisToOrdemNotaKpis,
} from '@/lib/orders/metrics'
import type {
  OrdemNotaAcompanhamento,
  OrdemNotaKpis,
  OrderReassignTarget,
  OrdersWorkspaceKpis,
} from '@/lib/types/database'

interface AdminPmplSectionProps {
  period: AdminDashboardPeriod
  reassignTargets: OrderReassignTarget[]
}

export async function AdminPmplSection({
  period,
  reassignTargets,
}: AdminPmplSectionProps) {
  const supabase = createAdminClient()

  const [pmplKpisResult, pmplRowsResult] = await Promise.all([
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
      p_tipo_ordem: 'PMPL',
    }),
    supabase.rpc('buscar_ordens_prioritarias_dashboard', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_limit: 20,
      p_tipo_ordem: 'PMPL',
    }),
  ])

  const firstError = [pmplKpisResult.error, pmplRowsResult.error].find(Boolean)
  if (firstError) throw firstError

  const rawPmplKpis = (pmplKpisResult.data ?? {}) as Partial<OrdersWorkspaceKpis>
  const pmplOrderKpis: OrdemNotaKpis = workspaceKpisToOrdemNotaKpis({
    total: Number(rawPmplKpis.total ?? 0),
    abertas: Number(rawPmplKpis.abertas ?? 0),
    em_tratativa: Number(rawPmplKpis.em_tratativa ?? 0),
    em_avaliacao: Number(rawPmplKpis.em_avaliacao ?? 0),
    concluidas: Number(rawPmplKpis.concluidas ?? 0),
    canceladas: Number(rawPmplKpis.canceladas ?? 0),
    avaliadas: Number(rawPmplKpis.avaliadas ?? 0),
    aguardando_faturamento: Number(rawPmplKpis.aguardando_faturamento ?? 0),
    atrasadas: Number(rawPmplKpis.atrasadas ?? 0),
    sem_responsavel: Number(rawPmplKpis.sem_responsavel ?? 0),
  })
  const pmplOrdersCriticality = getOrdersCriticalityLevel(
    pmplOrderKpis.total_ordens_30d,
    pmplOrderKpis.qtd_antigas_7d_30d
  )
  const pmplOrdensRows = (pmplRowsResult.data ?? []) as OrdemNotaAcompanhamento[]

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Acompanhamento PMPL</h2>
          <p className="text-sm text-muted-foreground">
            Ordens de manutenção planejada (PMPL) no período selecionado.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Período: {period.periodLabel}
        </span>
      </div>

      <OrdersKpiStrip
        kpis={pmplOrderKpis}
        activeKpi={null}
        criticality={pmplOrdersCriticality}
        interactive={false}
      />

      <OrdersAgingTable
        rows={pmplOrdensRows}
        title={`Ordens PMPL acompanhadas (${period.periodLabel})`}
        maxRows={20}
        showAdminColumns
        canReassign
        reassignTargets={reassignTargets}
        currentUserRole="gestor"
      />
    </section>
  )
}
