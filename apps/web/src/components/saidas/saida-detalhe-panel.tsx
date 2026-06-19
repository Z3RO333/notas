'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, Route as RouteIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cancelarSaidaOperacional, publicarSaidaNoRota } from '@/lib/actions/saidas-actions'
import type {
  RotaDispatchStatus,
  RotaDispatchSummary,
  SaidaDetalhe,
  SaidaOperacionalStatus,
  SaidaOrdemResultado,
} from '@/lib/types/saidas'

const STATUS_LABEL: Record<SaidaOperacionalStatus, string> = {
  em_rota: 'Em rota',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
}

const STATUS_VARIANT: Record<SaidaOperacionalStatus, 'default' | 'secondary' | 'destructive'> = {
  em_rota: 'default',
  finalizada: 'secondary',
  cancelada: 'destructive',
}

const RESULTADO_LABEL: Record<SaidaOrdemResultado, string> = {
  resolvida: 'Resolvida',
  nao_resolvida: 'Não resolvida',
  reagendada: 'Reagendada',
}

const RESULTADO_VARIANT: Record<SaidaOrdemResultado, 'default' | 'secondary' | 'destructive'> = {
  resolvida: 'default',
  nao_resolvida: 'destructive',
  reagendada: 'secondary',
}

const ROTA_STATUS_LABEL: Record<RotaDispatchStatus, string> = {
  published: 'Publicada',
  accepted: 'Aceita',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

interface SaidaDetalhePanelProps {
  saida: SaidaDetalhe
  rotaDispatch: RotaDispatchSummary | null
}

export function SaidaDetalhePanel({ saida, rotaDispatch }: SaidaDetalhePanelProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function handleCancelar() {
    if (!confirm('Cancelar esta saída?')) return
    startTransition(async () => {
      await cancelarSaidaOperacional(saida.id)
      router.refresh()
    })
  }

  function handlePublicarNoRota() {
    startTransition(async () => {
      const result = await publicarSaidaNoRota(saida.id)
      if (result.error) {
        toast({
          title: 'Não foi possível publicar no ROTA',
          description: result.error,
          variant: 'error',
        })
        return
      }

      toast({
        title: 'Rota publicada',
        description: `${saida.totalOrdens} ordens enviadas para ${saida.operacionalNomeSnapshot}`,
        variant: 'success',
      })
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-lg font-semibold">{saida.operacionalNomeSnapshot}</p>
          <p className="text-sm text-muted-foreground">{fmtDate(saida.dataSaida)}</p>
          {saida.observacao && <p className="text-sm">{saida.observacao}</p>}
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:justify-end">
          {rotaDispatch ? (
            <Badge variant="secondary" className="gap-1.5">
              <RouteIcon className="h-3.5 w-3.5" />
              ROTA: {ROTA_STATUS_LABEL[rotaDispatch.status]}
            </Badge>
          ) : saida.status === 'em_rota' ? (
            <Button variant="outline" size="sm" onClick={handlePublicarNoRota} disabled={isPending}>
              {isPending ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RouteIcon className="mr-2 h-4 w-4" />
              )}
              Publicar no ROTA
            </Button>
          ) : null}
          <Badge variant={STATUS_VARIANT[saida.status]}>{STATUS_LABEL[saida.status]}</Badge>
          <span className="text-sm tabular-nums text-muted-foreground">
            {saida.ordensComResultado} de {saida.totalOrdens} ordens concluídas
          </span>
          {saida.status === 'em_rota' && (
            <Button variant="destructive" size="sm" onClick={handleCancelar} disabled={isPending}>
              Cancelar saída
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-[12px] border border-border/60 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              {['Ordem', 'Unidade', 'Descrição', 'Status snapshot', 'Resultado', 'Observação'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {saida.ordens.map((o) => (
              <tr key={o.id} className="bg-card/30 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{o.ordemCodigo}</td>
                <td className="px-4 py-3 text-muted-foreground">{o.unidade ?? '—'}</td>
                <td className="px-4 py-3 max-w-[200px] truncate">{o.textoBreve ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{o.statusOrdemRawSnapshot ?? '—'}</td>
                <td className="px-4 py-3">
                  {o.resultado ? (
                    <Badge variant={RESULTADO_VARIANT[o.resultado]}>{RESULTADO_LABEL[o.resultado]}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Pendente</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{o.observacaoRetorno ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
