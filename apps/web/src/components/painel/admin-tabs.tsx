'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NotaCard } from './nota-card'
import { AdminSummary } from './admin-summary'
import { cn } from '@/lib/utils'
import type { Administrador, NotaManutencao } from '@/lib/types/database'

interface AdminTabsProps {
  admins: Administrador[]
  notas: NotaManutencao[]
  notasSemAtribuir: NotaManutencao[]
}

export function AdminTabs({ admins, notas, notasSemAtribuir }: AdminTabsProps) {
  const [activeTab, setActiveTab] = useState<string>(admins[0]?.id ?? 'sem-atribuir')
  const [statusFilter, setStatusFilter] = useState<string>('abertas')
  const [search, setSearch] = useState('')

  // Agrupa notas por admin
  const notasByAdmin = useMemo(() => {
    const map = new Map<string, NotaManutencao[]>()
    for (const admin of admins) {
      map.set(admin.id, notas.filter((n) => n.administrador_id === admin.id))
    }
    return map
  }, [admins, notas])

  // Notas da tab ativa
  const activeNotas = useMemo(() => {
    let list = activeTab === 'sem-atribuir'
      ? notasSemAtribuir
      : notasByAdmin.get(activeTab) ?? []

    // Filtra por status
    if (statusFilter === 'abertas') {
      list = list.filter((n) => n.status !== 'concluida' && n.status !== 'cancelada')
    } else if (statusFilter !== 'todas') {
      list = list.filter((n) => n.status === statusFilter)
    }

    // Filtra por busca
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (n) =>
          n.numero_nota.toLowerCase().includes(q) ||
          n.descricao.toLowerCase().includes(q)
      )
    }

    return list
  }, [activeTab, notasByAdmin, notasSemAtribuir, statusFilter, search])

  // Conta abertas por admin (pra mostrar na tab)
  function countAbertas(adminId: string) {
    const list = notasByAdmin.get(adminId) ?? []
    return list.filter((n) => n.status !== 'concluida' && n.status !== 'cancelada').length
  }

  // Todas as notas da tab ativa (sem filtro, pra summary)
  const allActiveNotas = activeTab === 'sem-atribuir'
    ? notasSemAtribuir
    : notasByAdmin.get(activeTab) ?? []

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por numero ou descricao..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Abertas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="nova">Novas</SelectItem>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="encaminhada_fornecedor">Encaminhadas</SelectItem>
            <SelectItem value="concluida">Concluidas</SelectItem>
            <SelectItem value="cancelada">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs dos tecnicos */}
      <div className="border-b">
        <div className="flex gap-1 overflow-x-auto pb-px">
          {admins.map((admin) => {
            const abertas = countAbertas(admin.id)
            const isActive = activeTab === admin.id
            return (
              <button
                key={admin.id}
                onClick={() => setActiveTab(admin.id)}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors border-b-2',
                  isActive
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {admin.nome}
                {abertas > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-bold',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {abertas}
                  </span>
                )}
              </button>
            )
          })}
          {/* Tab "Sem Atribuir" */}
          {notasSemAtribuir.length > 0 && (
            <button
              onClick={() => setActiveTab('sem-atribuir')}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors border-b-2',
                activeTab === 'sem-atribuir'
                  ? 'border-orange-500 text-orange-600 bg-orange-50'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              Sem Atribuir
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold',
                  activeTab === 'sem-atribuir'
                    ? 'bg-orange-500 text-white'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {notasSemAtribuir.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Resumo + Cards */}
      <div>
        <AdminSummary notas={allActiveNotas} />

        {activeNotas.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">
              Nenhuma nota encontrada
            </p>
            <p className="text-sm text-muted-foreground">
              {search || statusFilter !== 'abertas'
                ? 'Tente ajustar os filtros'
                : 'Novas notas aparecerao aqui automaticamente'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeNotas.map((nota) => (
              <NotaCard key={nota.id} nota={nota} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
