'use client'

import { useState, useMemo } from 'react'
import { Search, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { CollaboratorMiniCard } from './collaborator-mini-card'
import { CollaboratorAccordion } from './collaborator-accordion'
import { CollaboratorAdminActions } from './collaborator-admin-actions'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData } from '@/lib/types/database'

interface CollaboratorPanelProps {
  collaborators: CollaboratorData[]
  notas: NotaPanelData[]
  mode: 'viewer' | 'admin'
  notasSemAtribuir?: NotaPanelData[]
}

export function CollaboratorPanel({
  collaborators,
  notas,
  mode,
  notasSemAtribuir,
}: CollaboratorPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('abertas')

  // Group notes by admin in a single pass O(N)
  const notasByAdmin = useMemo(() => {
    const map = new Map<string, NotaPanelData[]>()
    for (const nota of notas) {
      if (!nota.administrador_id) continue
      const list = map.get(nota.administrador_id)
      if (list) {
        list.push(nota)
      } else {
        map.set(nota.administrador_id, [nota])
      }
    }
    return map
  }, [notas])

  // Filter notes for the expanded accordion
  function filterNotas(list: NotaPanelData[]) {
    let filtered = list

    if (statusFilter === 'abertas') {
      filtered = filtered.filter((n) => n.status !== 'concluida' && n.status !== 'cancelada')
    } else if (statusFilter !== 'todas') {
      filtered = filtered.filter((n) => n.status === statusFilter)
    }

    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (n) =>
          n.numero_nota.toLowerCase().includes(q) ||
          n.descricao.toLowerCase().includes(q)
      )
    }

    return filtered
  }

  function handleCardClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
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

      {/* Sticky collaborator grid */}
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur pt-1 pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
          {collaborators.map((c) => (
            <CollaboratorMiniCard
              key={c.id}
              collaborator={c}
              isExpanded={expandedId === c.id}
              onClick={() => handleCardClick(c.id)}
            />
          ))}

          {/* "Sem Atribuir" special card (viewer mode only) */}
          {mode === 'viewer' && notasSemAtribuir && notasSemAtribuir.length > 0 && (
            <Card
              onClick={() => handleCardClick('sem-atribuir')}
              className={`p-3 cursor-pointer transition-all hover:shadow-md border-orange-200 ${
                expandedId === 'sem-atribuir' ? 'ring-2 ring-orange-500 bg-orange-50' : ''
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                  <AlertCircle className="h-5 w-5 text-orange-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-orange-700">Sem Atribuir</p>
                  <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                    {notasSemAtribuir.length} nota{notasSemAtribuir.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Accordion sections */}
      {collaborators.map((c) => {
        const adminNotas = notasByAdmin.get(c.id) ?? []
        const filtered = filterNotas(adminNotas)

        return (
          <CollaboratorAccordion
            key={c.id}
            collaborator={c}
            notas={filtered}
            isOpen={expandedId === c.id}
            adminActions={mode === 'admin' ? <CollaboratorAdminActions admin={c} /> : undefined}
          />
        )
      })}

      {/* Unassigned notes accordion (viewer mode) */}
      {mode === 'viewer' && notasSemAtribuir && notasSemAtribuir.length > 0 && (
        <CollaboratorAccordion
          collaborator={{
            id: 'sem-atribuir',
            nome: 'Sem Atribuir',
            ativo: true,
            max_notas: 0,
            avatar_url: null,
            especialidade: 'geral',
            recebe_distribuicao: false,
            em_ferias: false,
            qtd_nova: notasSemAtribuir.filter((n) => n.status === 'nova').length,
            qtd_em_andamento: 0,
            qtd_encaminhada: 0,
            qtd_abertas: notasSemAtribuir.length,
            qtd_concluidas: 0,
          }}
          notas={filterNotas(notasSemAtribuir)}
          isOpen={expandedId === 'sem-atribuir'}
        />
      )}
    </div>
  )
}
