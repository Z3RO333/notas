import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AdminDashboardPeriod } from '@/lib/dashboard/period'
import type { OperacionalKpis, ProdutividadeOperacional, ServicoMaisFeito } from '@/lib/types/database'

interface AdminOperacionalSectionProps {
  period: AdminDashboardPeriod
}

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{value.toLocaleString('pt-BR')}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function ProdutividadeTable({ rows, periodLabel }: { rows: ProdutividadeOperacional[]; periodLabel: string }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtividade por Colaborador</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum operacional encontrado no período.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Produtividade por Colaborador
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Operacional</th>
                <th className="px-4 py-2 text-right font-medium">Atendidas</th>
                <th className="px-4 py-2 text-right font-medium">Em Aberto</th>
                <th className="px-4 py-2 text-right font-medium">Lojas</th>
                <th className="px-4 py-2 text-right font-medium">% Conclusão</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.fornecedor_codigo} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{row.fornecedor_nome || row.fornecedor_codigo}</span>
                    {row.fornecedor_nome && (
                      <span className="ml-1.5 text-xs text-muted-foreground">({row.fornecedor_codigo})</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {row.atendidas.toLocaleString('pt-BR')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={row.em_aberto > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                      {row.em_aberto.toLocaleString('pt-BR')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.lojas_atendidas.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={
                        row.pct_conclusao >= 80
                          ? 'font-medium text-emerald-600 dark:text-emerald-400'
                          : row.pct_conclusao >= 50
                            ? 'font-medium text-amber-600 dark:text-amber-400'
                            : 'font-medium text-red-600 dark:text-red-400'
                      }
                    >
                      {row.pct_conclusao.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function ServicosTopList({ rows, periodLabel }: { rows: ServicoMaisFeito[]; periodLabel: string }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Serviços Mais Feitos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum serviço encontrado no período.</p>
        </CardContent>
      </Card>
    )
  }

  const maxQtd = rows[0]?.quantidade ?? 1

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Serviços Mais Feitos
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate pr-2">{row.texto_breve}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {row.quantidade.toLocaleString('pt-BR')} ({row.pct_total.toFixed(1)}%)
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${(row.quantidade / maxQtd) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export async function AdminOperacionalSection({ period }: AdminOperacionalSectionProps) {
  const supabase = await createClient()

  const [kpisResult, produtividadeResult, servicosResult] = await Promise.all([
    supabase.rpc('calcular_kpis_operacionais', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
    }),
    supabase.rpc('calcular_produtividade_operacionais', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_limit: 50,
    }),
    supabase.rpc('calcular_servicos_mais_feitos', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_limit: 10,
    }),
  ])

  const firstError = [kpisResult.error, produtividadeResult.error, servicosResult.error].find(Boolean)
  if (firstError) throw firstError

  const kpisRaw = (kpisResult.data ?? [{}])[0] as Partial<OperacionalKpis>
  const kpis: OperacionalKpis = {
    total_operacionais: Number(kpisRaw.total_operacionais ?? 0),
    ordens_atendidas: Number(kpisRaw.ordens_atendidas ?? 0),
    ordens_em_aberto: Number(kpisRaw.ordens_em_aberto ?? 0),
    lojas_atendidas: Number(kpisRaw.lojas_atendidas ?? 0),
  }
  const produtividade = (produtividadeResult.data ?? []) as ProdutividadeOperacional[]
  const servicos = (servicosResult.data ?? []) as ServicoMaisFeito[]

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Operacional</h2>
          <p className="text-sm text-muted-foreground">
            Produtividade dos colaboradores operacionais (fornecedores) no período selecionado.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Período: {period.periodLabel}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Operacionais Ativos" value={kpis.total_operacionais} sub="com ordens no período" />
        <KpiCard label="Ordens Atendidas" value={kpis.ordens_atendidas} sub="status concluída" />
        <KpiCard label="Ordens em Aberto" value={kpis.ordens_em_aberto} sub="abertas + em tratativa" />
        <KpiCard label="Lojas Atendidas" value={kpis.lojas_atendidas} sub="unidades com conclusão" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProdutividadeTable rows={produtividade} periodLabel={period.periodLabel} />
        </div>
        <ServicosTopList rows={servicos} periodLabel={period.periodLabel} />
      </div>
    </section>
  )
}
