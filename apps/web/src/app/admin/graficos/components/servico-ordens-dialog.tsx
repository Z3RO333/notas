'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TipoUnidade } from '@/lib/types/database'

type ServicoOrdemRow = {
  ordem_id: string
  ordem_codigo: string | null
  tipo_ordem: string | null
  competencia_data: string | null
  ano: number
  mes: number
  nome_loja: string | null
  tipo_unidade: string | null
  texto_breve: string | null
  status_ordem_raw: string | null
  nota_referencia: string | null
}

const STATUS_LABEL: Record<string, string> = {
  CANCELADO: 'Cancelado',
  CONCLUIDO: 'Concluido',
  AGUARDANDO_FATURAMENTO_NF: 'Ag. Fat. NF',
  EXECUCAO_SATISFATORIO: 'Exec. Satisfatorio',
  EXECUCAO_SATISFATORIA: 'Exec. Satisfatoria',
  AVALIACAO_DA_EXECUCAO: 'Aval. Execucao',
  AVALIACAO_DE_EXECUCAO: 'Aval. Execucao',
  ABERTO: 'Aberto',
  ABERTA: 'Aberta',
  EM_EXECUCAO: 'Em Execucao',
  EQUIPAMENTO_EM_CONSERTO: 'Equip. Conserto',
  EXECUCAO_NAO_REALIZADA: 'Exec. Nao Real.',
  ENVIAR_EMAIL_PFORNECEDOR: 'Email Fornecedor',
  EM_PROCESSAMENTO: 'Em Processamento',
  EXECUCAO_INSATISFATORIO: 'Exec. Insatisfatorio',
}

interface ServicoOrdensDialogProps {
  servico: string
  tipoUnidade: TipoUnidade
  ano?: number
  mes?: number
  tipoOrdem?: string
  open: boolean
  onClose: () => void
}

export function ServicoOrdensDialog({
  servico,
  tipoUnidade,
  ano,
  mes,
  tipoOrdem,
  open,
  onClose,
}: ServicoOrdensDialogProps) {
  const [rows, setRows] = useState<ServicoOrdemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleSuffix = useMemo(() => {
    if (mes && ano) return `${String(mes).padStart(2, '0')}/${ano}`
    if (ano) return String(ano)
    return 'todos os periodos'
  }, [ano, mes])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const params = new URLSearchParams({
      servico,
      tipo_unidade: tipoUnidade,
    })

    if (ano) params.set('ano', String(ano))
    if (mes) params.set('mes', String(mes))
    if (tipoOrdem) params.set('tipo_ordem', tipoOrdem)

    setLoading(true)
    setError(null)

    fetch(`/api/graficos/servicos/ordens?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error ?? 'Falha ao carregar ordens do servico')
        }
        setRows((payload.rows ?? []) as ServicoOrdemRow[])
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return
        setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar ordens do servico')
        setRows([])
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [open, servico, tipoUnidade, ano, mes, tipoOrdem])

  function formatDate(value: string | null) {
    if (!value) return '—'
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{servico}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {tipoUnidade} • {titleSuffix}
            {tipoOrdem ? ` • ${tipoOrdem}` : ''}
          </p>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando ordens…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma ordem encontrada para este servico.</p>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b bg-background">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ordem</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Competencia</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Unidade</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nota</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.ordem_id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono">{row.ordem_codigo ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.tipo_ordem ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {STATUS_LABEL[row.status_ordem_raw ?? ''] ?? row.status_ordem_raw ?? '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.competencia_data)}</td>
                    <td className="px-3 py-2">{row.nome_loja ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.nota_referencia ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 pt-2 text-right text-xs text-muted-foreground">
              {rows.length} ordens
              {rows.length === 200 ? ' (limite 200)' : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
