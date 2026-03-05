'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, MapPin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProdutividadeOperacional, LojaPorOperacional } from '@/lib/types/database'

interface ProdutividadeTableProps {
  rows: ProdutividadeOperacional[]
  lojasMap: Record<string, LojaPorOperacional[]>
  periodLabel: string
}

export function ProdutividadeTable({ rows, lojasMap, periodLabel }: ProdutividadeTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(codigo: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(codigo)) {
        next.delete(codigo)
      } else {
        next.add(codigo)
      }
      return next
    })
  }

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
                <th className="w-6 px-2 py-2" />
                <th className="px-4 py-2 text-left font-medium">Operacional</th>
                <th className="px-4 py-2 text-right font-medium">Atendidas</th>
                <th className="px-4 py-2 text-right font-medium">Em Aberto</th>
                <th className="px-4 py-2 text-right font-medium">Lojas</th>
                <th className="px-4 py-2 text-right font-medium">% Conclusão</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const lojas = lojasMap[row.fornecedor_codigo] ?? []
                const isExpanded = expanded.has(row.fornecedor_codigo)
                const hasLojas = lojas.length > 0

                return (
                  <>
                    <tr
                      key={row.fornecedor_codigo}
                      className={`border-b last:border-0 transition-colors ${hasLojas ? 'cursor-pointer hover:bg-muted/20' : ''}`}
                      onClick={hasLojas ? () => toggle(row.fornecedor_codigo) : undefined}
                    >
                      <td className="w-6 px-2 py-2.5 text-muted-foreground">
                        {hasLojas ? (
                          isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )
                        ) : null}
                      </td>
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
                    {isExpanded && lojas.length > 0 && (
                      <tr key={`${row.fornecedor_codigo}-lojas`} className="border-b bg-muted/10 last:border-0">
                        <td />
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {lojas.map((loja) => (
                              <span
                                key={loja.unidade}
                                className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                              >
                                <MapPin className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">{loja.unidade}</span>
                                <span className="text-muted-foreground">×{loja.qtd_atendidas}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
