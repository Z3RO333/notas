'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trophy, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProdutividadeMensal, NotaConcluida, Especialidade } from '@/lib/types/database'

interface ProductivityTableProps {
  data: ProdutividadeMensal[]
  notasConcluidas: NotaConcluida[]
  totalAbertas: number
  totalConcluidas: number
}

const especialidadeConfig: Record<Especialidade, { label: string; color: string }> = {
  refrigeracao: { label: 'Refrigeracao', color: 'bg-cyan-100 text-cyan-800' },
  elevadores: { label: 'Elevadores/Geradores', color: 'bg-orange-100 text-orange-800' },
  geral: { label: 'Geral', color: 'bg-gray-100 text-gray-800' },
}

const REFRESH_INTERVAL = 30 // segundos

export function ProductivityTable({ data, notasConcluidas, totalAbertas, totalConcluidas }: ProductivityTableProps) {
  const router = useRouter()
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState(0)
  const [espFilter, setEspFilter] = useState<string>('todas')

  // Auto-refresh a cada 30 segundos
  const refresh = useCallback(() => {
    router.refresh()
    setSecondsSinceRefresh(0)
  }, [router])

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsSinceRefresh((prev) => {
        if (prev + 1 >= REFRESH_INTERVAL) {
          refresh()
          return 0
        }
        return prev + 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [refresh])

  // Meses disponiveis
  const months = useMemo(() => {
    const unique = [...new Set(data.map((d) => d.mes))]
      .sort((a, b) => b.localeCompare(a))

    if (unique.length === 0) {
      const now = new Date()
      const current = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      return [{ value: current, label: format(new Date(current), 'MMMM yyyy', { locale: ptBR }) }]
    }

    return unique.map((m) => ({
      value: m,
      label: format(new Date(m), 'MMMM yyyy', { locale: ptBR }),
    }))
  }, [data])

  const [selectedMonth, setSelectedMonth] = useState(months[0]?.value ?? '')

  // Filtra dados do mes selecionado
  const monthData = useMemo(() => {
    let filtered = data.filter((d) => d.mes === selectedMonth)
    if (espFilter !== 'todas') {
      filtered = filtered.filter((d) => d.especialidade === espFilter)
    }
    return filtered.sort((a, b) => b.qtd_concluidas - a.qtd_concluidas)
  }, [data, selectedMonth, espFilter])

  // Agrupa notas concluidas por admin (filtra pelo mes selecionado)
  const notasByAdmin = useMemo(() => {
    const map = new Map<string, NotaConcluida[]>()
    const monthStart = selectedMonth ? new Date(selectedMonth) : new Date()
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)

    for (const nota of notasConcluidas) {
      const concludedAt = new Date(nota.updated_at)
      if (concludedAt >= monthStart && concludedAt < monthEnd) {
        const list = map.get(nota.administrador_id) ?? []
        list.push(nota)
        map.set(nota.administrador_id, list)
      }
    }
    return map
  }, [notasConcluidas, selectedMonth])

  const totalMesConcluidas = monthData.reduce((sum, a) => sum + a.qtd_concluidas, 0)
  const maxConcluidas = monthData.length > 0 ? monthData[0].qtd_concluidas : 0

  // % progresso geral (concluidas vs total)
  const totalGeral = totalAbertas + totalConcluidas
  const percentualProgresso = totalGeral > 0 ? Math.round((totalConcluidas / totalGeral) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Header com barra de progresso e contador */}
      <div className="rounded-xl bg-slate-900 text-white p-6 space-y-4">
        {/* Barra de progresso */}
        <div className="space-y-1">
          <div className="h-6 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-6 rounded-full bg-blue-500 transition-all flex items-center justify-center text-xs font-bold"
              style={{ width: `${Math.max(percentualProgresso, 5)}%` }}
            >
              {percentualProgresso}%
            </div>
          </div>
        </div>

        {/* Contador grande */}
        <div className="text-center">
          <p className="text-5xl font-bold">{totalMesConcluidas}</p>
          <p className="text-lg text-slate-300">Chamados Fechados</p>
        </div>

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-52 bg-slate-800 border-slate-600 text-white">
              <SelectValue placeholder="Selecione o mes" />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={espFilter} onValueChange={setEspFilter}>
            <SelectTrigger className="w-52 bg-slate-800 border-slate-600 text-white">
              <SelectValue placeholder="Filtrar por time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as equipes</SelectItem>
              <SelectItem value="refrigeracao">Refrigeracao</SelectItem>
              <SelectItem value="elevadores">Elevadores/Geradores</SelectItem>
              <SelectItem value="geral">Geral</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cards dos admins */}
      {monthData.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            Nenhuma nota concluida neste mes
          </p>
          <p className="text-sm text-muted-foreground">
            Os dados aparecerao conforme notas forem concluidas
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {monthData.map((admin, index) => {
            const esp = especialidadeConfig[(admin.especialidade as Especialidade)] || especialidadeConfig.geral
            const isTop = index === 0 && admin.qtd_concluidas > 0
            const adminNotas = notasByAdmin.get(admin.administrador_id) ?? []

            return (
              <Card
                key={admin.administrador_id}
                className={`p-5 flex flex-col items-center gap-3 ${isTop ? 'ring-2 ring-yellow-400 bg-yellow-50/30' : ''}`}
              >
                <div className="relative">
                  <Avatar src={admin.avatar_url} nome={admin.nome} size="xl" />
                  {isTop && (
                    <div className="absolute -top-2 -right-2 rounded-full bg-yellow-400 p-1">
                      <Trophy className="h-4 w-4 text-yellow-900" />
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <p className="font-semibold text-base">{admin.nome}</p>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${esp.color}`}>
                    {esp.label}
                  </span>
                </div>

                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">{admin.qtd_concluidas}</p>
                </div>

                {maxConcluidas > 0 && (
                  <div className="w-full">
                    <div className="h-2.5 w-full rounded-full bg-muted">
                      <div
                        className="h-2.5 rounded-full bg-green-500 transition-all"
                        style={{ width: `${Math.round((admin.qtd_concluidas / maxConcluidas) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Lista de notas concluidas */}
                {adminNotas.length > 0 && (
                  <div className="w-full border-t pt-3 space-y-1.5">
                    {adminNotas.slice(0, 5).map((nota) => (
                      <Link
                        key={nota.id}
                        href={`/notas/${nota.id}`}
                        className="flex items-center justify-between text-xs hover:bg-muted/50 rounded px-1.5 py-1 transition-colors"
                      >
                        <span className="font-mono font-medium text-foreground">#{nota.numero_nota}</span>
                        <span className="text-muted-foreground">
                          {format(new Date(nota.updated_at), 'dd/MM')}
                        </span>
                      </Link>
                    ))}
                    {adminNotas.length > 5 && (
                      <p className="text-xs text-center text-muted-foreground">
                        +{adminNotas.length - 5} mais
                      </p>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Indicador de auto-refresh */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className={`h-3 w-3 ${secondsSinceRefresh >= REFRESH_INTERVAL - 2 ? 'animate-spin' : ''}`} />
        <span>Atualiza automaticamente a cada {REFRESH_INTERVAL}s</span>
        <button
          type="button"
          onClick={refresh}
          className="underline hover:text-foreground transition-colors"
        >
          Atualizar agora
        </button>
      </div>
    </div>
  )
}
