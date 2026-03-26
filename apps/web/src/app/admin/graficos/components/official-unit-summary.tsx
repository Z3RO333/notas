import {
  Activity,
  BadgeAlert,
  Building2,
  ChevronDown,
  Pill,
  ShoppingCart,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { GestaoSegmentoSummary, TipoUnidade } from '@/lib/types/database'
import {
  OFFICIAL_REFERENCE_TOTALS,
  getOfficialUnitAudit,
  type OfficialReferenceCategory,
} from '@/lib/units/official-unit-catalog'

interface OfficialUnitSummaryProps {
  segmentos: GestaoSegmentoSummary[]
}

const CARD_ORDER = ['LOJA', 'FARMA', 'LOTERIA', 'MERCADO', 'CD'] as const satisfies readonly OfficialReferenceCategory[]
type SummaryCardCategory = (typeof CARD_ORDER)[number]

const CONFIG: Record<SummaryCardCategory, {
  label: string
  icon: LucideIcon
  color: string
  bg: string
}> = {
  LOJA: {
    label: 'Lojas',
    icon: Building2,
    color: 'text-blue-600 dark:text-blue-300',
    bg: 'bg-blue-50/90 dark:bg-blue-950/25',
  },
  FARMA: {
    label: 'Farmas',
    icon: Pill,
    color: 'text-emerald-600 dark:text-emerald-300',
    bg: 'bg-emerald-50/90 dark:bg-emerald-950/25',
  },
  LOTERIA: {
    label: 'Loterias',
    icon: BadgeAlert,
    color: 'text-fuchsia-600 dark:text-fuchsia-300',
    bg: 'bg-fuchsia-50/90 dark:bg-fuchsia-950/25',
  },
  MERCADO: {
    label: 'Mercado',
    icon: ShoppingCart,
    color: 'text-amber-600 dark:text-amber-300',
    bg: 'bg-amber-50/90 dark:bg-amber-950/25',
  },
  CD: {
    label: 'CDs',
    icon: Warehouse,
    color: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-50/90 dark:bg-sky-950/25',
  },
}

function formatEntries(entries: Array<{ centro: string; unidade: string }>): string {
  return entries.map((entry) => `${entry.centro} ${entry.unidade}`).join(', ')
}

export function OfficialUnitSummary({ segmentos }: OfficialUnitSummaryProps) {
  const segmentosMap = Object.fromEntries(segmentos.map((segmento) => [segmento.tipo, segmento])) as Partial<
    Record<TipoUnidade, GestaoSegmentoSummary>
  >
  const audit = getOfficialUnitAudit()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {CARD_ORDER.map((tipo) => {
          const cfg = CONFIG[tipo]
          const Icon = cfg.icon
          const total = OFFICIAL_REFERENCE_TOTALS[tipo]
          const segmento = tipo === 'LOTERIA' || tipo === 'MERCADO' ? null : segmentosMap[tipo]

          return (
            <Card key={tipo} className={`border-0 shadow-sm ${cfg.bg}`}>
              <CardContent className="pt-5 pb-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-white/70 p-2 dark:bg-black/20">
                    <Icon className={`h-5 w-5 ${cfg.color}`} />
                  </div>
                  {segmento ? (
                    <Badge variant="outline" className="border-white/70 bg-white/70 dark:border-white/10 dark:bg-black/20">
                      {segmento.percentual_ordens.toFixed(1)}% das ordens
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-white/70 bg-white/70 dark:border-white/10 dark:bg-black/20">
                      Base oficial
                    </Badge>
                  )}
                </div>

                <div className="space-y-1">
                  <p className={`text-3xl font-bold ${cfg.color}`}>{total.toLocaleString('pt-BR')}</p>
                  <p className="text-sm font-medium text-foreground">{cfg.label}</p>
                  {segmento ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {segmento.unidades.toLocaleString('pt-BR')} com ordens no recorte atual
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {segmento.total_ordens.toLocaleString('pt-BR')} ordens e {segmento.total_notas.toLocaleString('pt-BR')} notas
                      </p>
                    </>
                  ) : tipo === 'LOTERIA' ? (
                    <p className="text-xs text-muted-foreground">Recorte oficial complementar da planilha.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Centros oficiais classificados fora do fallback de loja.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <details className="group rounded-2xl border border-dashed bg-muted/10">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="h-4 w-4 text-primary" />
              Auditoria da base oficial
            </div>
            <p className="max-w-4xl text-sm text-muted-foreground">
              Os KPIs usam a classificacao oficial da planilha. Expanda para ver ajustes, exclusoes e centros auditados.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-background/70">
              {OFFICIAL_REFERENCE_TOTALS.LOJA + OFFICIAL_REFERENCE_TOTALS.FARMA + OFFICIAL_REFERENCE_TOTALS.CD + OFFICIAL_REFERENCE_TOTALS.MERCADO} centros primarios auditados
            </Badge>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Ver detalhes
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </span>
          </div>
        </summary>

        <Card className="border-0 bg-transparent shadow-none">
          <CardContent className="space-y-4 pt-0 pb-5">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border bg-background/50 p-4">
                <p className="text-sm font-semibold text-foreground">Inflacao antiga que empurrava mercado e apoio para lojas</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatEntries(audit.legacyInflation.LOJA)}</p>
              </div>

              <div className="rounded-xl border bg-background/50 p-4">
                <p className="text-sm font-semibold text-foreground">Centros parecidos com farma removidos da contagem oficial</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatEntries(audit.legacyInflation.FARMA)}</p>
              </div>

              <div className="rounded-xl border bg-background/50 p-4">
                <p className="text-sm font-semibold text-foreground">CDs de apoio que nao entram no KPI principal</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatEntries(audit.legacyInflation.CD)}</p>
              </div>

              <div className="rounded-xl border bg-background/50 p-4">
                <p className="text-sm font-semibold text-foreground">Entradas complementares que precisaram ser adicionadas</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatEntries(audit.supplementalEntries)}</p>
              </div>
            </div>

            <div className="rounded-xl border bg-background/50 p-4">
              <p className="text-sm font-semibold text-foreground">Nota sobre loterias e recorte oficial</p>
              <p className="mt-1 text-sm text-muted-foreground">{audit.loteriaNote}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Centros fora da KPI primaria, mas mantidos no catalogo oficial para auditoria: {formatEntries(audit.excludedEntries)}.
              </p>
            </div>
          </CardContent>
        </Card>
      </details>
    </div>
  )
}
