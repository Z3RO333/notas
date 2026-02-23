'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Gauge, ListChecks, Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import {
  resolveCargoLabelFromEspecialidade,
  resolveCargoPresentationFromEspecialidade,
} from '@/lib/collaborator/cargo-presentation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NotaResumo, ProdutividadeMensal } from '@/lib/types/database'

interface ProductivityTableProps {
  data: ProdutividadeMensal[]
  notasConcluidas: NotaResumo[]
  totalAbertas: number
  totalConcluidas: number
}

export function ProductivityTable({ data, notasConcluidas, totalAbertas, totalConcluidas }: ProductivityTableProps) {
  const [espFilter, setEspFilter] = useState<string>('todas')

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

  const monthData = useMemo(() => {
    let filtered = data.filter((d) => d.mes === selectedMonth)
    if (espFilter !== 'todas') {
      filtered = filtered.filter((d) => d.especialidade === espFilter)
    }
    return filtered.sort((a, b) => b.qtd_concluidas - a.qtd_concluidas)
  }, [data, selectedMonth, espFilter])

  const notasByAdmin = useMemo(() => {
    const map = new Map<string, NotaResumo[]>()
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

  const totalGeral = totalAbertas + totalConcluidas
  const percentualProgresso = totalGeral > 0 ? Math.round((totalConcluidas / totalGeral) * 100) : 0

  const filterLabelByEspecialidade = {
    refrigeracao: resolveCargoLabelFromEspecialidade('refrigeracao'),
    elevadores: resolveCargoLabelFromEspecialidade('elevadores'),
    geral: resolveCargoLabelFromEspecialidade('geral'),
    cd_manaus: resolveCargoLabelFromEspecialidade('cd_manaus'),
    cd_taruma: resolveCargoLabelFromEspecialidade('cd_taruma'),
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl bg-slate-900 p-6 text-white">
        <div className="space-y-1">
          <div className="h-6 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className="flex h-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold transition-all"
              style={{ width: `${Math.max(percentualProgresso, 5)}%` }}
            >
              {percentualProgresso}%
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-5xl font-bold">{totalMesConcluidas}</p>
          <p className="text-lg text-slate-300">Chamados Fechados</p>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-52 border-slate-600 bg-slate-800 text-white">
              <SelectValue placeholder="Selecione o mês" />
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
            <SelectTrigger className="w-52 border-slate-600 bg-slate-800 text-white">
              <SelectValue placeholder="Filtrar por time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as equipes</SelectItem>
              <SelectItem value="refrigeracao">{filterLabelByEspecialidade.refrigeracao}</SelectItem>
              <SelectItem value="elevadores">{filterLabelByEspecialidade.elevadores}</SelectItem>
              <SelectItem value="geral">{filterLabelByEspecialidade.geral}</SelectItem>
              <SelectItem value="cd_manaus">{filterLabelByEspecialidade.cd_manaus}</SelectItem>
              <SelectItem value="cd_taruma">{filterLabelByEspecialidade.cd_taruma}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {monthData.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            Nenhuma nota concluída neste mês
          </p>
          <p className="text-sm text-muted-foreground">
            Os dados aparecerão conforme notas forem concluídas
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {monthData.map((admin, index) => {
            const cargo = resolveCargoPresentationFromEspecialidade(admin.especialidade)
            const isTop = index === 0 && admin.qtd_concluidas > 0
            const adminNotas = notasByAdmin.get(admin.administrador_id) ?? []
            const percentualVsTop = maxConcluidas > 0
              ? Math.round((admin.qtd_concluidas / maxConcluidas) * 100)
              : 0

            return (
              <CollaboratorCardShell
                key={admin.administrador_id}
                variant="compact"
                name={admin.nome}
                avatarUrl={admin.avatar_url}
                avatarSize="lg"
                cargo={cargo}
                className={isTop ? 'ring-2 ring-yellow-400 bg-yellow-50/30' : ''}
                statusBadges={isTop ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-800">
                    <Trophy className="h-3 w-3" />
                    Top 1
                  </span>
                ) : null}
                primaryMetric={{
                  id: 'concluidas',
                  label: 'Concluídas no mês',
                  value: admin.qtd_concluidas,
                  tone: 'success',
                  icon: CheckCircle2,
                }}
                secondaryMetrics={[
                  {
                    id: 'vs-lider',
                    label: '% do líder',
                    value: `${percentualVsTop}%`,
                    tone: 'info',
                    icon: Gauge,
                  },
                  {
                    id: 'notas',
                    label: 'Notas no mês',
                    value: adminNotas.length,
                    tone: 'neutral',
                    icon: ListChecks,
                  },
                ]}
                details={(
                  <div className="space-y-2">
                    {maxConcluidas > 0 && (
                      <div className="w-full">
                        <div className="h-2.5 w-full rounded-full bg-muted">
                          <div
                            className="h-2.5 rounded-full bg-green-500 transition-all"
                            style={{ width: `${percentualVsTop}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {adminNotas.length > 0 && (
                      <div className="w-full space-y-1.5 border-t pt-2">
                        {adminNotas.slice(0, 5).map((nota) => (
                          <Link
                            key={nota.id}
                            href={`/notas/${nota.id}`}
                            className="flex items-center justify-between rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted/50"
                          >
                            <span className="font-mono font-medium text-foreground">#{nota.numero_nota}</span>
                            <span className="text-muted-foreground">
                              {format(new Date(nota.updated_at), 'dd/MM')}
                            </span>
                          </Link>
                        ))}
                        {adminNotas.length > 5 && (
                          <p className="text-center text-xs text-muted-foreground">
                            +{adminNotas.length - 5} mais
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
