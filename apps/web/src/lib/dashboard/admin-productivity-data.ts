import type {
  EvolucaoMensalOperacional,
  OrdemNotaRankingAdmin,
  OrdersWorkspaceKpis,
  ProdutividadeOperacional,
} from '@/lib/types/database'
import type { ProductivityMonthWindow } from './productivity-month'

type AdminMonthlyEvolutionRaw = {
  ano?: number | string | null
  mes?: number | string | null
  concluidas?: number | string | null
  em_aberto?: number | string | null
}

type AdminProductivityDashboardPayload = {
  current_kpis?: Partial<OrdersWorkspaceKpis> | null
  previous_kpis?: Partial<OrdersWorkspaceKpis> | null
  current_ranking?: Partial<OrdemNotaRankingAdmin>[] | null
  previous_ranking?: Partial<OrdemNotaRankingAdmin>[] | null
  monthly_evolution?: AdminMonthlyEvolutionRaw[] | null
}

export interface NormalizedAdminProductivityDashboardPayload {
  currentKpis: OrdersWorkspaceKpis
  previousKpis: OrdersWorkspaceKpis
  currentRanking: OrdemNotaRankingAdmin[]
  previousRanking: OrdemNotaRankingAdmin[]
  evolution: EvolucaoMensalOperacional[]
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeFornecedorCodigo(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '')
}

export function pickOperationalAvatarCodes(rows: ProdutividadeOperacional[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => normalizeFornecedorCodigo(row.fornecedor_codigo))
        .filter(Boolean),
    ),
  )
}

function normalizeOrdersKpis(raw: Partial<OrdersWorkspaceKpis> | null | undefined): OrdersWorkspaceKpis {
  return {
    total: toNumber(raw?.total),
    abertas: toNumber(raw?.abertas),
    em_tratativa: toNumber(raw?.em_tratativa),
    em_avaliacao: toNumber(raw?.em_avaliacao),
    concluidas: toNumber(raw?.concluidas),
    canceladas: toNumber(raw?.canceladas),
    avaliadas: toNumber(raw?.avaliadas),
    aguardando_faturamento: toNumber(raw?.aguardando_faturamento),
    atrasadas: toNumber(raw?.atrasadas),
    sem_responsavel: toNumber(raw?.sem_responsavel),
  }
}

function normalizeRankingRows(rows: Partial<OrdemNotaRankingAdmin>[] | null | undefined): OrdemNotaRankingAdmin[] {
  return (rows ?? []).map((row) => ({
    administrador_id: row.administrador_id ?? '',
    nome: row.nome ?? 'Sem nome',
    qtd_ordens_30d: toNumber(row.qtd_ordens_30d),
    qtd_abertas_30d: toNumber(row.qtd_abertas_30d),
    qtd_em_tratativa_30d: toNumber(row.qtd_em_tratativa_30d),
    qtd_concluidas_30d: toNumber(row.qtd_concluidas_30d),
    qtd_canceladas_30d: toNumber(row.qtd_canceladas_30d),
    qtd_antigas_7d_30d: toNumber(row.qtd_antigas_7d_30d),
    tempo_medio_geracao_dias_30d:
      row.tempo_medio_geracao_dias_30d === null || row.tempo_medio_geracao_dias_30d === undefined
        ? null
        : toNumber(row.tempo_medio_geracao_dias_30d),
  }))
}

export function normalizeAdminProductivityDashboardPayload(
  payload: unknown,
  rollingMonths: ProductivityMonthWindow[],
): NormalizedAdminProductivityDashboardPayload {
  const raw = (payload ?? {}) as AdminProductivityDashboardPayload
  const evolutionByMonth = new Map(
    (raw.monthly_evolution ?? []).map((row) => {
      const year = toNumber(row.ano)
      const month = toNumber(row.mes)
      return [
        `${year}-${month}`,
        {
          concluidas: toNumber(row.concluidas),
          em_aberto: toNumber(row.em_aberto),
        },
      ]
    }),
  )

  return {
    currentKpis: normalizeOrdersKpis(raw.current_kpis),
    previousKpis: normalizeOrdersKpis(raw.previous_kpis),
    currentRanking: normalizeRankingRows(raw.current_ranking),
    previousRanking: normalizeRankingRows(raw.previous_ranking),
    evolution: rollingMonths
      .filter((monthWindow): monthWindow is ProductivityMonthWindow & { month: number } => monthWindow.month !== null)
      .map((monthWindow) => {
        const monthData = evolutionByMonth.get(`${monthWindow.year}-${monthWindow.month}`)
      return {
        ano: monthWindow.year,
        mes: monthWindow.month,
        label: monthWindow.label,
        concluidas: monthData?.concluidas ?? 0,
        em_aberto: monthData?.em_aberto ?? 0,
      }
      }),
  }
}

export function isMissingAdminProductivityPayloadRpc(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined,
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true

  const haystacks = [error.message, error.details, error.hint]
  return haystacks.some((value) => (value ?? '').toLowerCase().includes('calcular_dashboard_produtividade_admin'))
}
