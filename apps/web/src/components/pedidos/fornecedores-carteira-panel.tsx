'use client'

import { useState } from 'react'
import { ArrowLeftRight, BarChart3, CheckCircle2, ListChecks, Search, TrendingUp, XCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { CockpitKpiStrip, type CockpitKpiItem } from '@/components/cockpit/cockpit-kpi-strip'
import { PedidosCarteiraRealocarDialog } from '@/components/pedidos/pedidos-carteira-realocar-dialog'
import type {
  PedidosCarteiraFornecedorRow,
  PedidosCarteiraResponse,
  PedidosCarteiraTipo,
} from '@/lib/types/pedidos'
import { CARTEIRA_EMPTY_MESSAGES } from '@/lib/pedidos/carteira-helpers'

const ALL_VALUE = '__all__'

// Fornecedores mapeados na seed dos pedidos anuais 2026 (migration 00281),
// com os números de pedido (SAP) correspondentes
const PEDIDO_ANUAL_2026_NUMEROS: Record<string, string[]> = {
  '41': ['4508545460', '4508540137'],
  '15327': ['4508548452'],
  '500': ['4508546423'],
  '9331': ['4508546761'],
  '17162': ['4508557436'],
  '9214': ['4508554021'],
  '12034': ['4508554000'],
  '10745': ['4508561865'],
  '16904': ['4508551006'],
  '672': ['4508539789'],
  '15594': ['4508547151'],
  '13851': ['4508546803'],
  '17017': ['4508607259'],
  '1188': ['4508553643', '4508551149', '4508595428'],
  '14604': ['4508557420'],
  '13400': ['4508539831'],
  '16513': ['4508546120'],
  '15202': ['4508537868'],
  '16119': ['4508548763'],
  '12697': ['4508551000'],
  '11371': ['4508550869'],
  '6405': ['4508554010', '4508565238'],
  '8059': ['4508548699'],
  '10364': ['4508548366'],
  '16744': ['4508564720'],
  '7949': ['4508591118'],
  '101': ['4508557761', '4508560364', '4508590825'],
  '9542': ['4508539437'],
  '17753': ['4508539797'],
  '12171': ['4508539985'],
  '10070': ['4508539572'],
  '10295': ['4508540048'],
  '15738': ['4508540095'],
  '14897': ['4508540165'],
  '12029': ['4508540202'],
  '13379': ['4508540214'],
  '15363': ['4508540220'],
  '18053': ['4508621364'],
}

function fmtCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function useCarteiraFornecedores(tipoCarteira: PedidosCarteiraTipo) {
  return useQuery<PedidosCarteiraResponse>({
    queryKey: ['pedidos-carteira-fornecedores', tipoCarteira],
    queryFn: async () => {
      const res = await fetch(`/api/pedidos/carteira-fornecedores?tipo=${tipoCarteira}`, { cache: 'no-store' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar carteira de fornecedores')
      }
      return res.json() as Promise<PedidosCarteiraResponse>
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })
}

interface FornecedoresCarteiraPanelProps {
  isGestor: boolean
  tipoCarteira: PedidosCarteiraTipo
}

export function FornecedoresCarteiraPanel({ isGestor, tipoCarteira }: FornecedoresCarteiraPanelProps) {
  const { data, isPending, error } = useCarteiraFornecedores(tipoCarteira)
  const [busca, setBusca] = useState('')
  const [filtroAdmin, setFiltroAdmin] = useState(ALL_VALUE)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<PedidosCarteiraFornecedorRow | null>(null)

  if (isPending) {
    return (
      <div className="space-y-4">
        <CockpitKpiStrip
          items={[]}
          loading
          columnsClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        />
        <Card>
          <CardContent className="p-0">
            <div className="space-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Erro ao carregar carteira de fornecedores.'}
      </p>
    )
  }

  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          {CARTEIRA_EMPTY_MESSAGES[tipoCarteira]}
        </CardContent>
      </Card>
    )
  }

  const { rows, kpis, availableAdmins } = data

  const items: CockpitKpiItem[] = [
    { id: 'fornecedores', label: 'Fornecedores', value: fmtCount(kpis.totalFornecedores), icon: ListChecks },
    { id: 'pedidos', label: 'Pedidos', value: fmtCount(kpis.totalPedidos), icon: BarChart3 },
    { id: 'em_aberto', label: 'Em aberto', value: fmtCount(kpis.emAberto), icon: BarChart3 },
    { id: 'encerrado', label: 'Encerrados', value: fmtCount(kpis.encerrado), icon: CheckCircle2, tone: 'success' },
    { id: 'cancelado', label: 'Cancelados', value: fmtCount(kpis.cancelado), icon: XCircle, tone: kpis.cancelado > 0 ? 'critical' : 'neutral' },
    { id: 'valor_total', label: 'Valor', value: fmtCurrency(kpis.valorTotal), icon: TrendingUp },
  ]

  const adminsUnicos = Array.from(
    new Map(rows.map((r) => [r.adminId, { id: r.adminId, nome: r.adminNome }])).values(),
  ).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'))

  const rowsFiltradas = rows.filter((row) => {
    if (filtroAdmin !== ALL_VALUE && row.adminId !== filtroAdmin) return false
    if (busca) {
      const q = busca.toLowerCase()
      const nome = row.fornecedorNome.toLowerCase()
      const codigo = row.fornecedorCodigo.toLowerCase()
      if (!nome.includes(q) && !codigo.includes(q)) return false
    }
    return true
  })

  function handleRealocar(row: PedidosCarteiraFornecedorRow) {
    setSelectedRow(row)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <CockpitKpiStrip items={items} columnsClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" />

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar fornecedor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={filtroAdmin} onValueChange={setFiltroAdmin}>
          <SelectTrigger className="h-8 w-[200px] text-sm">
            <SelectValue placeholder="Todos os responsáveis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos os responsáveis</SelectItem>
            {adminsUnicos.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nome ?? a.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-[12px] border border-border/60 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Fornecedor
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Responsável
              </th>
              {tipoCarteira === 'preventiva_anual' && (
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Nº Pedido
                </th>
              )}
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pedidos
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Valor total
              </th>
              {isGestor && (
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ação
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rowsFiltradas.length === 0 && (
              <tr>
                <td colSpan={isGestor ? (tipoCarteira === 'preventiva_anual' ? 7 : 6) : (tipoCarteira === 'preventiva_anual' ? 6 : 5)} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum fornecedor encontrado.
                </td>
              </tr>
            )}
            {rowsFiltradas.map((row) => (
              <tr key={row.fornecedorCodigo} className="bg-card/30 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium leading-tight">{row.fornecedorNome}</p>
                  <p className="text-xs text-muted-foreground">cod. {row.fornecedorCodigo}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar src={row.adminAvatar} nome={row.adminNome ?? '?'} size="sm" />
                    <span>{row.adminNome ?? '—'}</span>
                  </div>
                </td>
                {tipoCarteira === 'preventiva_anual' && (
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {PEDIDO_ANUAL_2026_NUMEROS[row.fornecedorCodigo]?.map((numero) => (
                        <span key={numero} className="font-mono text-xs tabular-nums text-foreground">
                          {numero}
                        </span>
                      )) ?? <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                )}
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {fmtCount(row.qtdPedidos)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="default" className="text-[11px]">
                      {row.emAberto} aberto{row.emAberto === 1 ? '' : 's'}
                    </Badge>
                    <Badge variant="secondary" className="text-[11px]">
                      {row.encerrado} encerrado{row.encerrado === 1 ? '' : 's'}
                    </Badge>
                    {row.cancelado > 0 && (
                      <Badge variant="destructive" className="text-[11px]">
                        {row.cancelado} cancelado{row.cancelado === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {fmtCurrency(row.valorTotal)}
                </td>
                {isGestor && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => handleRealocar(row)}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Realocar
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRow && (
        <PedidosCarteiraRealocarDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          fornecedorCodigo={selectedRow.fornecedorCodigo}
          fornecedorNome={selectedRow.fornecedorNome}
          adminAtualId={selectedRow.adminId}
          adminAtualNome={selectedRow.adminNome}
          candidates={availableAdmins.map((a) => ({ id: a.id, nome: a.nome, avatar_url: a.avatar_url }))}
        />
      )}
    </div>
  )
}
