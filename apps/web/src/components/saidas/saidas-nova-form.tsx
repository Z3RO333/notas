'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQuery } from '@tanstack/react-query'
import { criarSaidaOperacional } from '@/lib/actions/saidas-actions'
import type { CriarSaidaOrdemInput } from '@/lib/types/saidas'

interface DimOperacional {
  codigo: string
  nome: string
}

interface OrdemBuscaItem {
  ordem_codigo: string
  numero_nota: string | null
  unidade: string | null
  texto_breve: string | null
  status_ordem_raw: string | null
  tipo_ordem: string | null
}

interface SaidasNovaFormProps {
  operacionais: DimOperacional[]
}

export function SaidasNovaForm({ operacionais }: SaidasNovaFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [operacionalCodigo, setOperacionalCodigo] = useState('')
  const [dataSaida, setDataSaida] = useState('')
  const [observacao, setObservacao] = useState('')
  const [busca, setBusca] = useState('')
  const [selecionadas, setSelecionadas] = useState<Map<string, OrdemBuscaItem>>(new Map())
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: resultadosBusca, isFetching, error: buscaError } = useQuery<{ rows: OrdemBuscaItem[] }>({
    queryKey: ['busca-ordens-saida', busca],
    queryFn: async () => {
      if (!busca.trim() || busca.trim().length < 3) return { rows: [] }
      const res = await fetch(`/api/ordens/busca-simples?q=${encodeURIComponent(busca)}`)
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? 'Falha ao buscar ordens')
      }
      return res.json()
    },
    staleTime: 10_000,
    enabled: busca.trim().length >= 3,
  })

  const ordensSelecionadas = Array.from(selecionadas.values())

  function toggleOrdem(item: OrdemBuscaItem) {
    setSelecionadas((prev) => {
      const next = new Map(prev)
      if (next.has(item.ordem_codigo)) next.delete(item.ordem_codigo)
      else next.set(item.ordem_codigo, item)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!operacionalCodigo) return setSubmitError('Selecione um técnico')
    if (!dataSaida) return setSubmitError('Informe a data da saída')
    if (selecionadas.size === 0) return setSubmitError('Selecione ao menos uma ordem')
    setSubmitError(null)

    const ordens: CriarSaidaOrdemInput[] = Array.from(selecionadas.values()).map((o) => ({
      ordem_codigo: o.ordem_codigo,
      numero_nota: o.numero_nota,
      unidade: o.unidade,
      texto_breve: o.texto_breve,
      status_ordem_raw_snapshot: o.status_ordem_raw,
      tipo_ordem: o.tipo_ordem,
    }))

    startTransition(async () => {
      const result = await criarSaidaOperacional(operacionalCodigo, dataSaida, observacao || null, ordens)
      if (result.error) {
        setSubmitError(result.error)
      } else {
        router.push(`/admin/saidas/${result.data!.id}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Painel esquerdo: cabeçalho */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Técnico</label>
              <Select value={operacionalCodigo} onValueChange={setOperacionalCodigo}>
                <SelectTrigger><SelectValue placeholder="Selecione o técnico…" /></SelectTrigger>
                <SelectContent>
                  {operacionais.map((op) => (
                    <SelectItem key={op.codigo} value={op.codigo}>{op.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Data e hora da saída</label>
              <Input
                type="datetime-local"
                value={dataSaida}
                onChange={(e) => setDataSaida(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Observação (opcional)</label>
              <Textarea
                placeholder="Instruções para o técnico…"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Ordens desta saída</p>
                <span className="text-xs text-muted-foreground">{selecionadas.size} selecionada(s)</span>
              </div>
              {ordensSelecionadas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Busque e adicione todas as ordens que o técnico vai atender.</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {ordensSelecionadas.map((item) => (
                    <div key={item.ordem_codigo} className="flex items-start gap-3 rounded-md border bg-background/70 p-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold">{item.ordem_codigo}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.unidade ?? 'Sem unidade'} · {item.texto_breve ?? 'Sem descrição'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => toggleOrdem(item)}
                        aria-label={`Remover ordem ${item.ordem_codigo}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? 'Criando…' : `Criar saída com ${selecionadas.size} ordem(ns)`}
            </Button>
          </CardContent>
        </Card>

        {/* Painel direito: busca e seleção de ordens */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Buscar ordens</label>
              <Input
                placeholder="Número da ordem, nota ou unidade (mín. 3 chars)…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {isFetching && <p className="text-sm text-muted-foreground">Buscando…</p>}
              {!isFetching && buscaError && (
                <p className="text-sm text-destructive">
                  {buscaError instanceof Error ? buscaError.message : 'Falha ao buscar ordens'}
                </p>
              )}
              {!isFetching && !buscaError && resultadosBusca?.rows.length === 0 && busca.trim().length >= 3 && (
                <p className="text-sm text-muted-foreground">Nenhuma ordem encontrada.</p>
              )}
              {resultadosBusca?.rows.map((item) => (
                <label
                  key={item.ordem_codigo}
                  className="flex items-start gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-muted/30"
                >
                  <input
                    type="checkbox"
                    checked={selecionadas.has(item.ordem_codigo)}
                    onChange={() => toggleOrdem(item)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{item.ordem_codigo}</p>
                    <p className="text-xs text-muted-foreground">{item.unidade} · {item.texto_breve}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}
