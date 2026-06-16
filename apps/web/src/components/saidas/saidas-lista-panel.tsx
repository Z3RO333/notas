'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { OperacionalSaida, SaidaOperacionalStatus } from '@/lib/types/saidas'

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

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

interface DimOperacional {
  codigo: string
  nome: string
}

interface SaidasListaPanelProps {
  operacionais: DimOperacional[]
}

export function SaidasListaPanel({ operacionais }: SaidasListaPanelProps) {
  const [filtroOp, setFiltroOp] = useState('__all__')
  const [filtroStatus, setFiltroStatus] = useState('__all__')

  const params = new URLSearchParams()
  if (filtroOp !== '__all__') params.set('operacional_codigo', filtroOp)
  if (filtroStatus !== '__all__') params.set('status', filtroStatus)

  const { data, isPending, error } = useQuery<{ rows: OperacionalSaida[] }>({
    queryKey: ['saidas-lista', filtroOp, filtroStatus],
    queryFn: async () => {
      const res = await fetch(`/api/saidas?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Falha ao carregar saídas')
      return res.json()
    },
    staleTime: 30_000,
  })

  if (isPending) {
    return (
      <Card><CardContent className="p-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-20" />
          </div>
        ))}
      </CardContent></Card>
    )
  }

  if (error) return <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Erro'}</p>

  const rows = data?.rows ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={filtroOp} onValueChange={setFiltroOp}>
          <SelectTrigger className="h-8 w-[200px] text-sm">
            <SelectValue placeholder="Todos os técnicos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os técnicos</SelectItem>
            {operacionais.map((op) => (
              <SelectItem key={op.codigo} value={op.codigo}>{op.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="h-8 w-[160px] text-sm">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os status</SelectItem>
            <SelectItem value="em_rota">Em rota</SelectItem>
            <SelectItem value="finalizada">Finalizada</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Link href="/admin/saidas/nova">
          <Button size="sm" className="h-8">Nova saída</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nenhuma saída encontrada.</CardContent></Card>
      ) : (
        <div className="rounded-[12px] border border-border/60 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                {['Técnico', 'Data', 'Status', 'Ordens', 'Ação'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => (
                <tr key={row.id} className="bg-card/30 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{row.operacionalNomeSnapshot}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtDate(row.dataSaida)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.totalOrdens}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/saidas/${row.id}`}>
                      <Button variant="outline" size="sm" className="h-7 text-xs">Ver</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
