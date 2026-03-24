'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CHART_AXIS_TICK,
  CHART_CATEGORY_TICK,
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
} from '@/components/charts/chart-theme'
import {
  createInsideBarLabelRenderer,
  getPositiveDomainMax,
} from '@/components/charts/stacked-bar-label'
import { calculateShare, formatPercent } from '@/components/charts/chart-percentages'
import { createWrappedCategoryTickRenderer } from '@/components/charts/wrapped-category-tick'
import type { GestaoTopLoja, TipoUnidade } from '@/lib/types/database'
import { useChartLabels } from '@/components/charts/chart-labels-context'
import { createClient } from '@/lib/supabase/client'

const TIPO_TITULO: Record<TipoUnidade, string> = {
  LOJA: 'Top Lojas - Ordens Geradas',
  FARMA: 'Top Farmas - Ordens Geradas',
  CD: 'Top CDs - Ordens Geradas',
}

const INSIDE_LIGHT_LABEL = createInsideBarLabelRenderer({
  fill: '#ffffff',
  fontSize: 10,
  fontWeight: 600,
  paddingX: 6,
  formatter: (value) => {
    const numericValue = Number(value)
    return numericValue > 0 ? numericValue.toLocaleString('pt-BR') : ''
  },
})

const INSIDE_DARK_LABEL = createInsideBarLabelRenderer({
  fill: '#111827',
  fontSize: 10,
  fontWeight: 700,
  paddingX: 6,
  formatter: (value) => {
    const numericValue = Number(value)
    return numericValue > 0 ? numericValue.toLocaleString('pt-BR') : ''
  },
})

const WRAPPED_CATEGORY_TICK = createWrappedCategoryTickRenderer({
  fill: CHART_CATEGORY_TICK.fill,
  fontSize: CHART_CATEGORY_TICK.fontSize,
  fontWeight: 500,
  maxCharsPerLine: 20,
  maxLines: 3,
  dx: -8,
})

const MIN_STACKED_SEGMENT_PIXELS = 20

function resolveMinPointSizeFromSegment(value: number | null | undefined) {
  return value && value > 0 ? MIN_STACKED_SEGMENT_PIXELS : 0
}

const STATUS_LABEL: Record<string, string> = {
  CANCELADO: 'Cancelado',
  CONCLUIDO: 'Concluído',
  AGUARDANDO_FATURAMENTO_NF: 'Ag. Fat. NF',
  EXECUCAO_SATISFATORIO: 'Exec. Satisfatório',
  EXECUCAO_SATISFATORIA: 'Exec. Satisfatória',
  AVALIACAO_DA_EXECUCAO: 'Aval. Execução',
  AVALIACAO_DE_EXECUCAO: 'Aval. Execução',
  ABERTO: 'Aberto',
  ABERTA: 'Aberta',
  EM_EXECUCAO: 'Em Execução',
  EQUIPAMENTO_EM_CONSERTO: 'Equip. Conserto',
  EXECUCAO_NAO_REALIZADA: 'Exec. Não Real.',
  ENVIAR_EMAIL_PFORNECEDOR: 'Email Fornecedor',
  EM_PROCESSAMENTO: 'Em Processamento',
  EXECUCAO_INSATISFATORIO: 'Exec. Insatisfatório',
}

type OrdemRow = {
  id: string
  ordem_codigo: string | null
  status_ordem_raw: string | null
  data_entrada: string | null
  tipo_ordem: string | null
  criado_por?: string | null
  // quando vem da query direta:
  notas_manutencao?: { descricao: string | null; centro: string | null } | null
  // quando vem da RPC buscar_ordens_equipamento:
  descricao?: string | null
  centro?: string | null
}

interface OrdensDialogProps {
  nomeLoja: string
  ano?: number
  mes?: number
  tipoOrdem?: string
  equipamento?: string
  categoria?: string  // se fornecido, usa RPC filtrada por categoria
  open: boolean
  onClose: () => void
}

function OrdensDialog({ nomeLoja, ano, mes, tipoOrdem, equipamento, categoria, open, onClose }: OrdensDialogProps) {
  const [ordens, setOrdens] = useState<OrdemRow[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    setLoading(true)

    if (categoria) {
      // Usa RPC que filtra por keyword da categoria (elevadores/refrigeracao)
      supabase
        .rpc('buscar_ordens_equipamento', {
          p_nome_loja: nomeLoja,
          p_categoria: categoria,
          p_ano: ano ?? null,
          p_mes: mes ?? null,
          p_tipo_ordem: tipoOrdem ?? null,
          p_equipamento: equipamento ?? null,
        })
        .then(({ data }) => {
          setOrdens((data as unknown as OrdemRow[]) ?? [])
          setLoading(false)
        })
    } else {
      // Query direta para o drill-down genérico da página Gráficos
      let q = supabase
        .from('ordens_notas_acompanhamento')
        .select('id, ordem_codigo, status_ordem_raw, data_entrada, tipo_ordem, criado_por, notas_manutencao!nota_id(descricao, centro)')
        .eq('denominacao_unidade', nomeLoja)
        .order('data_entrada', { ascending: false })
        .limit(200)

      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      if (mes && ano) {
        const pad = String(mes).padStart(2, '0')
        const lastDay = new Date(ano, mes, 0).getDate()
        q = q.filter('data_entrada', 'gte', `${ano}-${pad}-01`)
             .filter('data_entrada', 'lte', `${ano}-${pad}-${lastDay}`)
      } else if (ano) {
        q = q.filter('data_entrada', 'gte', `${ano}-01-01`)
             .filter('data_entrada', 'lte', `${ano}-12-31`)
      }

      q.then(({ data }) => {
        setOrdens((data as unknown as OrdemRow[]) ?? [])
        setLoading(false)
      })
    }
  }, [open, nomeLoja, ano, mes, tipoOrdem, equipamento, categoria, supabase])

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{nomeLoja}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando ordens…</p>
        ) : ordens.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma ordem encontrada.</p>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Ordem</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Tipo</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Data Entrada</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Serviço</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Criado por</th>
                </tr>
              </thead>
              <tbody>
                {ordens.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-1.5 px-3 font-mono">{row.ordem_codigo ?? '—'}</td>
                    <td className="py-1.5 px-3">{row.tipo_ordem ?? '—'}</td>
                    <td className="py-1.5 px-3 whitespace-nowrap">
                      {STATUS_LABEL[row.status_ordem_raw ?? ''] ?? row.status_ordem_raw ?? '—'}
                    </td>
                    <td className="py-1.5 px-3 whitespace-nowrap">{formatDate(row.data_entrada)}</td>
                    <td className="py-1.5 px-3 max-w-[240px] truncate">
                      {row.descricao ?? row.notas_manutencao?.descricao ?? '—'}
                    </td>
                    <td className="py-1.5 px-3 whitespace-nowrap">{row.criado_por ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground text-right pt-2 px-3">
              {ordens.length} ordens
              {ordens.length === 200 ? ' (limite 200)' : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface TopLojasChartProps {
  data: GestaoTopLoja[]
  tipoUnidade?: TipoUnidade
  ano?: number
  mes?: number
  tipoOrdem?: string
  equipamento?: string
  categoria?: string  // quando passado, drill-down filtra por categoria (equipamentos)
}

export function TopLojasChart({ data, tipoUnidade, ano, mes, tipoOrdem, equipamento, categoria }: TopLojasChartProps) {
  const { showLabels } = useChartLabels()
  const [selectedLoja, setSelectedLoja] = useState<string | null>(null)
  const titulo = tipoUnidade ? TIPO_TITULO[tipoUnidade] : 'Top Unidades - Ordens Geradas'

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{titulo}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para o periodo selecionado.
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = [...data].map((row) => ({
    ...row,
    total_exibido: row.concluidas + row.em_aberto,
  }))
  const chartTotal = chartData.reduce((sum, row) => sum + row.total_exibido, 0)
  const axisMax = getPositiveDomainMax(chartData.map((row) => row.total_exibido), 0.06, 4)
  const topShare = calculateShare(chartData[0]?.total_exibido ?? 0, chartTotal)
  const getMinPointSizeForDataKey =
    (dataKey: 'concluidas' | 'em_aberto') =>
    (_value: number | null | undefined, index: number) =>
      resolveMinPointSizeFromSegment(chartData[index]?.[dataKey])

  return (
    <>
      <Card>
        <CardHeader className="px-4 pb-4">
          <CardTitle className="text-base">{titulo}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Maior participacao no recorte: {formatPercent(topShare)}
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <p className="text-xs text-muted-foreground mb-2">Clique em uma barra para ver as ordens</p>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 4, right: 24, bottom: 4, left: 0 }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={CHART_AXIS_TICK} domain={[0, axisMax]} />
                <YAxis type="category" dataKey="nome_loja" width={212} tick={WRAPPED_CATEGORY_TICK} interval={0} />
                <Tooltip
                  formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="rounded border bg-popover px-3 py-2 text-xs shadow-md">
                        <p className="font-medium mb-1">{label}</p>
                        <p>
                          Concluidas:{' '}
                          <span className="font-semibold text-green-600">{d.concluidas.toLocaleString('pt-BR')}</span>
                          <span className="text-muted-foreground"> ({formatPercent(calculateShare(d.concluidas, d.total_exibido))})</span>
                        </p>
                        <p>
                          Em Aberto:{' '}
                          <span className="font-semibold text-amber-500">{d.em_aberto.toLocaleString('pt-BR')}</span>
                          <span className="text-muted-foreground"> ({formatPercent(calculateShare(d.em_aberto, d.total_exibido))})</span>
                        </p>
                        <p className="mt-1 border-t pt-1">Total: <span className="font-semibold">{(d.concluidas + d.em_aberto).toLocaleString('pt-BR')}</span></p>
                        <p className="text-muted-foreground">
                          Participacao no grafico: {formatPercent(calculateShare(d.total_exibido, chartTotal))}
                        </p>
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                <Bar
                  dataKey="concluidas"
                  name="Concluidas"
                  stackId="a"
                  fill="#16a34a"
                  minPointSize={getMinPointSizeForDataKey('concluidas')}
                  onClick={(entry) => setSelectedLoja(entry.nome_loja)}
                >
                  {showLabels && (
                    <LabelList
                      dataKey="concluidas"
                      content={INSIDE_LIGHT_LABEL}
                    />
                  )}
                </Bar>
                <Bar
                  dataKey="em_aberto"
                  name="Em Aberto"
                  stackId="a"
                  fill="#f59e0b"
                  radius={[0, 4, 4, 0]}
                  minPointSize={getMinPointSizeForDataKey('em_aberto')}
                  onClick={(entry) => setSelectedLoja(entry.nome_loja)}
                >
                  {showLabels && (
                    <LabelList
                      dataKey="em_aberto"
                      content={INSIDE_DARK_LABEL}
                    />
                  )}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {selectedLoja && (
        <OrdensDialog
          nomeLoja={selectedLoja}
          ano={ano}
          mes={mes}
          tipoOrdem={tipoOrdem}
          equipamento={equipamento}
          categoria={categoria}
          open={!!selectedLoja}
          onClose={() => setSelectedLoja(null)}
        />
      )}
    </>
  )
}
