import { readFirstParam } from '@/lib/grid/query'
import type { CriticalityLevel, GestaoBaseOrdem, TipoUnidade } from '@/lib/types/database'
import { getOfficialGestaoUniverseCount, getOfficialGestaoUniverseNames } from '@/lib/units/official-unit-catalog'

export type PreventivePeriodPreset = 'mes' | 'trimestre' | 'semestre' | 'ano'
export type PreventiveUnitTypeFilter = TipoUnidade | 'todos'

export interface PreventiveAnalysisSearchParams {
  ano?: string | string[]
  mes?: string | string[]
  tipo_ordem?: string | string[]
  preventiva_periodo?: string | string[]
  preventiva_ano?: string | string[]
  preventiva_mes?: string | string[]
  preventiva_tipo_unidade?: string | string[]
  preventiva_loja?: string | string[]
  preventiva_servico?: string | string[]
}

export interface PreventiveMonthRef {
  year: number
  month: number
}

export interface PreventivePeriod {
  preset: PreventivePeriodPreset
  year: number
  month: number | null
  months: PreventiveMonthRef[]
  startDate: string
  endDate: string
  periodLabel: string
}

export interface PreventiveRpcParams {
  p_ano: number
  p_mes: number | null
  p_tipo_ordem: string | null
}

export interface PreventiveFilterOption {
  value: string
  label: string
  meta?: string
}

export interface PreventiveAnalysisOptions {
  useOfficialUnitBase?: boolean
}

export interface PreventiveMetricCard {
  label: string
  value: string
  hint: string
  tone: CriticalityLevel
}

export interface PreventiveStoreServiceRow {
  service: string
  count: number
  average: number
  activeStores: number
  coveragePct: number
  totalOrders: number
  risk: CriticalityLevel
  message: string
}

export interface PreventiveServiceStoreRow {
  store: string
  count: number
  average: number
  deltaFromAverage: number
  totalOrders: number
  risk: CriticalityLevel
  message: string
}

export interface PreventiveAlertRow {
  store: string
  service: string
  count: number
  average: number
  risk: CriticalityLevel
  message: string
}

export interface PreventiveFocusSummary {
  service: string | null
  selectedStoreCount: number
  averagePerStore: number
  totalOrders: number
  storesWithOrders: number
  storesWithoutOrders: number
  selectedStoreRisk: CriticalityLevel
  autoSelected: boolean
}

export interface PreventiveAnalysisResult {
  period: PreventivePeriod
  unitType: PreventiveUnitTypeFilter
  unitTypeLabel: string
  store: string | null
  service: string | null
  storeTotalOrders: number
  storeRiskCounts: Record<CriticalityLevel, number>
  totalOrders: number
  totalStores: number
  totalServices: number
  alerts: PreventiveAlertRow[]
  metricCards: PreventiveMetricCard[]
  storeRows: PreventiveStoreServiceRow[]
  serviceRows: PreventiveServiceStoreRow[]
  focusSummary: PreventiveFocusSummary
  options: {
    unitTypes: PreventiveFilterOption[]
    stores: PreventiveFilterOption[]
    services: PreventiveFilterOption[]
  }
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const UNIT_ORDER: TipoUnidade[] = ['LOJA', 'FARMA', 'CD']
const UNIT_LABEL: Record<PreventiveUnitTypeFilter, string> = {
  todos: 'Todas as unidades',
  LOJA: 'Lojas',
  FARMA: 'Farmas',
  CD: 'CDs',
}
const PREVENTIVE_SERVICE_INCLUDE_TOKENS = ['PINTURA', 'TELHADO', 'CALHA', 'INFILTRAC']

const SERVICE_STORE_INELIGIBILITY_RULES: ServiceStoreEligibilityRule[] = [
  {
    serviceIncludes: ['ESCADA ROLANTE'],
    blockedStores: new Set(['LOJA MATRIZ', 'MATRIZ']),
  },
]

type StoreMeta = {
  name: string
  totalOrders: number
}

type ServiceMeta = {
  name: string
  totalOrders: number
  activeStores: number
  eligibleStores: number
  coveragePct: number
  average: number
}

type ServiceStoreEligibilityRule = {
  serviceIncludes: string[]
  blockedStores: Set<string>
}

interface RiskEvaluation {
  level: CriticalityLevel
  message: string
  gap: number
}

function formatYmd(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseYear(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return null
  return parsed
}

function parseMonth(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) return null
  return parsed
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeRuleKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function isRecurringPreventiveService(service: string | null | undefined): boolean {
  const serviceKey = normalizeRuleKey(service)
  if (!serviceKey) return false

  return PREVENTIVE_SERVICE_INCLUDE_TOKENS.some((token) => serviceKey.includes(token))
}

function addMonths(ref: PreventiveMonthRef, delta: number): PreventiveMonthRef {
  const date = new Date(Date.UTC(ref.year, ref.month - 1 + delta, 1))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  }
}

function buildTrailingMonths(anchorYear: number, anchorMonth: number, spanMonths: number): PreventiveMonthRef[] {
  const anchor = { year: anchorYear, month: anchorMonth }
  const months: PreventiveMonthRef[] = []
  for (let offset = spanMonths - 1; offset >= 0; offset -= 1) {
    months.push(addMonths(anchor, -offset))
  }
  return months
}

function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_SHORT[month - 1] ?? month}/${year}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: value >= 10 ? 0 : 1,
    minimumFractionDigits: value > 0 && value < 10 && value % 1 !== 0 ? 1 : 0,
  }).format(value)
}

function riskWeight(level: CriticalityLevel): number {
  if (level === 'critico') return 2
  if (level === 'atencao') return 1
  return 0
}

function evaluatePreventiveRisk({
  count,
  average,
  activeStores,
  totalStores,
}: {
  count: number
  average: number
  activeStores: number
  totalStores: number
}): RiskEvaluation {
  const coveragePct = totalStores > 0 ? activeStores / totalStores : 0
  const roundedAverage = Number(average.toFixed(1))

  if (totalStores < 2 || activeStores < 2) {
    return {
      level: 'saudavel',
      message: count > 0 ? 'Sem base suficiente para comparar o comportamento.' : 'Amostra pequena para sinal preventivo.',
      gap: Math.max(0, average - count),
    }
  }

  if (count === 0 && (coveragePct >= 0.35 || average >= 1)) {
    return {
      level: 'critico',
      message: `Sem abertura no recorte; ${activeStores}/${totalStores} unidades abriram esse serviço (média ${formatNumber(roundedAverage)}).`,
      gap: Math.max(1, average),
    }
  }

  if (count === 0) {
    return {
      level: 'atencao',
      message: `Sem abertura no recorte; vale confirmar se a demanda está represada.`,
      gap: Math.max(1, average),
    }
  }

  if (average >= 2 && count <= Math.max(1, Math.floor(average * 0.4))) {
    return {
      level: 'atencao',
      message: `Volume abaixo da média do grupo (${formatNumber(roundedAverage)} por unidade).`,
      gap: Math.max(0, average - count),
    }
  }

  if (coveragePct >= 0.6 && average >= 1.5 && count < average) {
    return {
      level: 'atencao',
      message: `Abaixo do padrão observado para o serviço (${activeStores}/${totalStores} unidades com abertura).`,
      gap: Math.max(0, average - count),
    }
  }

  return {
    level: 'saudavel',
    message: 'Comportamento dentro do padrão observado.',
    gap: Math.max(0, average - count),
  }
}

function dedupeOrders(rows: GestaoBaseOrdem[]): GestaoBaseOrdem[] {
  const seen = new Set<string>()
  const deduped: GestaoBaseOrdem[] = []

  for (const row of rows) {
    const key = row.ordem_id || `${row.ordem_codigo}::${row.competencia_data ?? 'sem-data'}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }

  return deduped
}

function resolvePreset(rawPreset: string | undefined, hasGlobalMonth: boolean): PreventivePeriodPreset {
  if (rawPreset === 'mes' || rawPreset === 'trimestre' || rawPreset === 'semestre' || rawPreset === 'ano') {
    return rawPreset
  }
  return hasGlobalMonth ? 'mes' : 'ano'
}

function trimRow(row: GestaoBaseOrdem): GestaoBaseOrdem | null {
  const store = row.nome_loja?.trim()
  const service = row.texto_breve?.trim()
  if (!store || !service || !row.tipo_unidade) return null

  return {
    ...row,
    nome_loja: store,
    texto_breve: service,
  }
}

function isServiceEligibleForStore(store: string | null | undefined, service: string | null | undefined): boolean {
  const storeKey = normalizeRuleKey(store)
  const serviceKey = normalizeRuleKey(service)

  if (!storeKey || !serviceKey) return true

  for (const rule of SERVICE_STORE_INELIGIBILITY_RULES) {
    if (!rule.blockedStores.has(storeKey)) continue
    if (rule.serviceIncludes.some((token) => serviceKey.includes(token))) {
      return false
    }
  }

  return true
}

function buildServiceMeta(rows: GestaoBaseOrdem[], storeUniverse: string[]): ServiceMeta[] {
  const totals = new Map<string, number>()
  const storeSets = new Map<string, Set<string>>()

  for (const row of rows) {
    const service = row.texto_breve
    const store = row.nome_loja
    if (!service || !store) continue
    totals.set(service, (totals.get(service) ?? 0) + 1)
    const storeSet = storeSets.get(service) ?? new Set<string>()
    storeSet.add(store)
    storeSets.set(service, storeSet)
  }

  return Array.from(totals.entries())
    .map(([service, totalOrders]) => {
      const activeStores = storeSets.get(service)?.size ?? 0
      const eligibleStores = Math.max(
        storeUniverse.filter((store) => isServiceEligibleForStore(store, service)).length,
        activeStores,
      )
      return {
        name: service,
        totalOrders,
        activeStores,
        eligibleStores,
        coveragePct: eligibleStores > 0 ? activeStores / eligibleStores : 0,
        average: eligibleStores > 0 ? totalOrders / eligibleStores : 0,
      }
    })
    .sort((left, right) => {
      if (right.totalOrders !== left.totalOrders) return right.totalOrders - left.totalOrders
      return left.name.localeCompare(right.name, 'pt-BR')
    })
}

function buildServiceCountMap(rows: GestaoBaseOrdem[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const service = row.texto_breve
    const store = row.nome_loja
    if (!service || !store) continue

    const byStore = counts.get(service) ?? new Map<string, number>()
    byStore.set(store, (byStore.get(store) ?? 0) + 1)
    counts.set(service, byStore)
  }

  return counts
}

function resolveSelectedUnitType(rows: GestaoBaseOrdem[], rawUnitType: string | undefined): PreventiveUnitTypeFilter {
  const available = new Set<TipoUnidade>()
  for (const row of rows) {
    if (row.tipo_unidade) available.add(row.tipo_unidade)
  }

  if (rawUnitType === 'todos') return 'todos'
  if ((rawUnitType === 'LOJA' || rawUnitType === 'FARMA' || rawUnitType === 'CD') && available.has(rawUnitType)) {
    return rawUnitType
  }

  for (const candidate of UNIT_ORDER) {
    if (available.has(candidate)) return candidate
  }

  return 'todos'
}

export function resolvePreventivePeriod(
  searchParams?: PreventiveAnalysisSearchParams,
  now: Date = new Date(),
): PreventivePeriod {
  const rawGlobalYear = readFirstParam(searchParams?.ano)
  const rawGlobalMonth = readFirstParam(searchParams?.mes)
  const rawPreset = readFirstParam(searchParams?.preventiva_periodo)
  const rawYear = readFirstParam(searchParams?.preventiva_ano)
  const rawMonth = readFirstParam(searchParams?.preventiva_mes)

  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const globalYear = parseYear(rawGlobalYear)
  const globalMonth = parseMonth(rawGlobalMonth)
  const preset = resolvePreset(rawPreset, globalMonth !== null)
  const year = parseYear(rawYear) ?? globalYear ?? currentYear
  const month = parseMonth(rawMonth) ?? globalMonth ?? currentMonth

  if (preset === 'ano') {
    return {
      preset,
      year,
      month: null,
      months: Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 })),
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      periodLabel: `Ano ${year}`,
    }
  }

  const span = preset === 'mes' ? 1 : preset === 'trimestre' ? 3 : 6
  const months = buildTrailingMonths(year, month, span)
  const first = months[0]
  const last = months[months.length - 1]
  const startDate = `${first.year}-${String(first.month).padStart(2, '0')}-01`
  const endExclusive = new Date(Date.UTC(last.year, last.month, 1))
  const endDate = formatYmd(new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000))
  const periodLabel = months.length === 1
    ? formatMonthLabel(last.year, last.month)
    : `${formatMonthLabel(first.year, first.month)} a ${formatMonthLabel(last.year, last.month)}`

  return {
    preset,
    year,
    month,
    months,
    startDate,
    endDate,
    periodLabel,
  }
}

export function buildPreventiveRpcParams(
  period: PreventivePeriod,
  tipoOrdem: string | undefined,
): PreventiveRpcParams[] {
  const tipoOrdemRpc = tipoOrdem && tipoOrdem !== 'todos' ? tipoOrdem : null

  if (period.preset === 'ano') {
    return [{ p_ano: period.year, p_mes: null, p_tipo_ordem: tipoOrdemRpc }]
  }

  return period.months.map((monthRef) => ({
    p_ano: monthRef.year,
    p_mes: monthRef.month,
    p_tipo_ordem: tipoOrdemRpc,
  }))
}

export function buildPreventiveAnalysis(
  rows: GestaoBaseOrdem[],
  period: PreventivePeriod,
  searchParams?: PreventiveAnalysisSearchParams,
  options: PreventiveAnalysisOptions = {},
): PreventiveAnalysisResult {
  const cleanedRows = dedupeOrders(rows)
    .map(trimRow)
    .filter((row): row is GestaoBaseOrdem => row !== null && isRecurringPreventiveService(row.texto_breve))

  const rawUnitType = readFirstParam(searchParams?.preventiva_tipo_unidade)
  const rawStore = normalizeText(readFirstParam(searchParams?.preventiva_loja))
  const rawService = normalizeText(readFirstParam(searchParams?.preventiva_servico))

  const unitType = resolveSelectedUnitType(cleanedRows, rawUnitType)
  const scopedRows = unitType === 'todos'
    ? cleanedRows
    : cleanedRows.filter((row) => row.tipo_unidade === unitType)

  const storeTotals = new Map<string, number>()
  for (const row of scopedRows) {
    const store = row.nome_loja
    if (!store) continue
    storeTotals.set(store, (storeTotals.get(store) ?? 0) + 1)
  }

  const stores: StoreMeta[] = Array.from(storeTotals.entries())
    .map(([name, totalOrders]) => ({ name, totalOrders }))
    .sort((left, right) => {
      if (right.totalOrders !== left.totalOrders) return right.totalOrders - left.totalOrders
      return left.name.localeCompare(right.name, 'pt-BR')
    })

  const observedStoreCount = stores.length
  const networkStoreCount = options.useOfficialUnitBase
    ? getOfficialGestaoUniverseCount(unitType)
    : observedStoreCount
  const storeUniverse = options.useOfficialUnitBase
    ? getOfficialGestaoUniverseNames(unitType)
    : stores.map((store) => store.name)

  const serviceMeta = buildServiceMeta(scopedRows, storeUniverse)
  const serviceCounts = buildServiceCountMap(scopedRows)

  const selectedStore = stores.some((store) => store.name === rawStore)
    ? rawStore
    : stores[0]?.name ?? null
  const eligibleServiceMeta = selectedStore
    ? serviceMeta.filter((service) => isServiceEligibleForStore(selectedStore, service.name))
    : serviceMeta
  const selectedService = eligibleServiceMeta.some((service) => service.name === rawService)
    ? rawService
    : null

  const storeRows = selectedStore
    ? eligibleServiceMeta.map((service) => {
      const count = serviceCounts.get(service.name)?.get(selectedStore) ?? 0
      const risk = evaluatePreventiveRisk({
        count,
        average: service.average,
        activeStores: service.activeStores,
        totalStores: service.eligibleStores,
      })

      return {
        service: service.name,
        count,
        average: Number(service.average.toFixed(1)),
        activeStores: service.activeStores,
        coveragePct: Number((service.coveragePct * 100).toFixed(1)),
        totalOrders: service.totalOrders,
        risk: risk.level,
        message: risk.message,
      }
    }).sort((left, right) => {
      const riskDiff = riskWeight(right.risk) - riskWeight(left.risk)
      if (riskDiff !== 0) return riskDiff
      if (left.count !== right.count) return left.count - right.count
      if (right.totalOrders !== left.totalOrders) return right.totalOrders - left.totalOrders
      return left.service.localeCompare(right.service, 'pt-BR')
    })
    : []

  const focusService = selectedService
    ?? storeRows[0]?.service
    ?? (selectedStore ? (eligibleServiceMeta[0]?.name ?? null) : serviceMeta[0]?.name)
    ?? null
  const focusServiceAutoSelected = selectedService === null && focusService !== null
  const focusServiceMeta = focusService
    ? serviceMeta.find((service) => service.name === focusService) ?? null
    : null

  const serviceRows = focusService
    ? stores.filter((store) => isServiceEligibleForStore(store.name, focusService)).map((store) => {
      const count = serviceCounts.get(focusService)?.get(store.name) ?? 0
      const risk = evaluatePreventiveRisk({
        count,
        average: focusServiceMeta?.average ?? 0,
        activeStores: focusServiceMeta?.activeStores ?? 0,
        totalStores: focusServiceMeta?.eligibleStores ?? networkStoreCount,
      })

      return {
        store: store.name,
        count,
        average: Number((focusServiceMeta?.average ?? 0).toFixed(1)),
        deltaFromAverage: Number((count - (focusServiceMeta?.average ?? 0)).toFixed(1)),
        totalOrders: store.totalOrders,
        risk: risk.level,
        message: risk.message,
      }
    }).sort((left, right) => {
      const riskDiff = riskWeight(right.risk) - riskWeight(left.risk)
      if (riskDiff !== 0) return riskDiff
      if (left.count !== right.count) return left.count - right.count
      if (right.totalOrders !== left.totalOrders) return right.totalOrders - left.totalOrders
      return left.store.localeCompare(right.store, 'pt-BR')
    })
    : []

  const relevantServices = serviceMeta.filter((service) => (
    service.activeStores >= 2 && (service.totalOrders >= 3 || service.coveragePct >= 0.2)
  ))

  const alerts: PreventiveAlertRow[] = []
  for (const service of relevantServices) {
    for (const store of stores) {
      if (!isServiceEligibleForStore(store.name, service.name)) continue

      const count = serviceCounts.get(service.name)?.get(store.name) ?? 0
      const risk = evaluatePreventiveRisk({
        count,
        average: service.average,
        activeStores: service.activeStores,
        totalStores: service.eligibleStores,
      })
      if (risk.level === 'saudavel') continue

      alerts.push({
        store: store.name,
        service: service.name,
        count,
        average: Number(service.average.toFixed(1)),
        risk: risk.level,
        message: risk.message,
      })
    }
  }

  alerts.sort((left, right) => {
    const riskDiff = riskWeight(right.risk) - riskWeight(left.risk)
    if (riskDiff !== 0) return riskDiff
    const leftGap = Math.abs(left.average - left.count)
    const rightGap = Math.abs(right.average - right.count)
    if (rightGap !== leftGap) return rightGap - leftGap
    if (left.count !== right.count) return left.count - right.count
    const serviceDiff = left.service.localeCompare(right.service, 'pt-BR')
    if (serviceDiff !== 0) return serviceDiff
    return left.store.localeCompare(right.store, 'pt-BR')
  })

  const criticalAlerts = alerts.filter((alert) => alert.risk === 'critico').length
  const attentionAlerts = alerts.filter((alert) => alert.risk === 'atencao').length
  const zeroGaps = alerts.filter((alert) => alert.count === 0).length
  const focusStoreServiceRow = focusService && selectedStore
    ? storeRows.find((row) => row.service === focusService) ?? null
    : null

  const storeRiskCounts: Record<CriticalityLevel, number> = {
    saudavel: storeRows.filter((row) => row.risk === 'saudavel').length,
    atencao: storeRows.filter((row) => row.risk === 'atencao').length,
    critico: storeRows.filter((row) => row.risk === 'critico').length,
  }

  const focusSummary: PreventiveFocusSummary = {
    service: focusService,
    selectedStoreCount: focusStoreServiceRow?.count ?? 0,
    averagePerStore: Number((focusServiceMeta?.average ?? 0).toFixed(1)),
    totalOrders: focusServiceMeta?.totalOrders ?? 0,
    storesWithOrders: focusServiceMeta?.activeStores ?? 0,
    storesWithoutOrders: Math.max(0, (focusServiceMeta?.eligibleStores ?? networkStoreCount) - (focusServiceMeta?.activeStores ?? 0)),
    selectedStoreRisk: focusStoreServiceRow?.risk ?? 'saudavel',
    autoSelected: focusServiceAutoSelected,
  }

  const totalOrders = scopedRows.length
  const totalStores = networkStoreCount
  const totalServices = serviceMeta.length
  const storeTotalOrders = selectedStore ? storeTotals.get(selectedStore) ?? 0 : 0

  const coverageHint = options.useOfficialUnitBase && totalStores !== observedStoreCount
    ? `${observedStoreCount} com ordens no recorte de ${totalStores} unidades oficiais`
    : `${totalStores} unidades e ${totalServices} serviços monitorados`

  const metricCards: PreventiveMetricCard[] = [
    {
      label: 'Ordens no recorte',
      value: totalOrders.toLocaleString('pt-BR'),
      hint: coverageHint,
      tone: 'saudavel',
    },
    {
      label: selectedStore ? `Carteira de ${selectedStore}` : 'Loja em foco',
      value: storeTotalOrders.toLocaleString('pt-BR'),
      hint: selectedStore
        ? `${storeRiskCounts.critico} riscos criticos e ${storeRiskCounts.atencao} pontos de atencao`
        : 'Escolha uma unidade para detalhar os serviços',
      tone: storeRiskCounts.critico > 0 ? 'critico' : storeRiskCounts.atencao > 0 ? 'atencao' : 'saudavel',
    },
    {
      label: focusService ? `${focusService} na unidade` : 'Serviço em foco',
      value: focusSummary.selectedStoreCount.toLocaleString('pt-BR'),
      hint: focusService
        ? `Média da rede: ${formatNumber(focusSummary.averagePerStore)}; ${focusSummary.storesWithoutOrders} unidades sem abertura`
        : 'Selecione um serviço para comparar unidades',
      tone: focusSummary.selectedStoreRisk,
    },
    {
      label: 'Alertas preventivos',
      value: (criticalAlerts + attentionAlerts).toLocaleString('pt-BR'),
      hint: `${criticalAlerts} críticos, ${attentionAlerts} atenção e ${zeroGaps} ausências totais relevantes`,
      tone: criticalAlerts > 0 ? 'critico' : attentionAlerts > 0 ? 'atencao' : 'saudavel',
    },
  ]

  return {
    period,
    unitType,
    unitTypeLabel: UNIT_LABEL[unitType],
    store: selectedStore,
    service: selectedService,
    storeTotalOrders,
    storeRiskCounts,
    totalOrders,
    totalStores,
    totalServices,
    alerts: alerts.slice(0, 12),
    metricCards,
    storeRows,
    serviceRows,
    focusSummary,
    options: {
      unitTypes: [
        { value: 'todos', label: UNIT_LABEL.todos },
        ...UNIT_ORDER
          .filter((candidate) => cleanedRows.some((row) => row.tipo_unidade === candidate))
          .map((candidate) => ({
            value: candidate,
            label: UNIT_LABEL[candidate],
            meta: `${cleanedRows.filter((row) => row.tipo_unidade === candidate).length.toLocaleString('pt-BR')} ordens`,
          })),
      ],
      stores: stores.map((store) => ({
        value: store.name,
        label: store.name,
        meta: `${store.totalOrders.toLocaleString('pt-BR')} ordens`,
      })),
      services: eligibleServiceMeta.map((service) => ({
        value: service.name,
        label: service.name,
        meta: `${service.totalOrders.toLocaleString('pt-BR')} ordens`,
      })),
    },
  }
}
