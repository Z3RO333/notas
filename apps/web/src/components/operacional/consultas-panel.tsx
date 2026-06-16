'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { OrdemConsultaCard } from '@/components/operacional/ordem-consulta-card'
import { SaidaView } from '@/components/operacional/saida-view'
import type { ConsultasResponse, OrdemConsulta } from '@/lib/types/operacional'
import type { SaidaDetalhe } from '@/lib/types/saidas'

const STATUS_OPTIONS = [
  { value: 'EQUIPAMENTO_EM_CONSERTO', label: 'Em conserto' },
  { value: 'EM_PROCESSAMENTO', label: 'Em processamento' },
  { value: 'CONCLUIDO', label: 'Concluído' },
  { value: 'CANCELADO', label: 'Cancelado' },
]

interface ConsultasPanelProps {
  operacionalCodigo: string | null
  saidaAtiva: SaidaDetalhe | null
}

export function ConsultasPanel({ operacionalCodigo, saidaAtiva }: ConsultasPanelProps) {
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [minhasOrdens, setMinhasOrdens] = useState(Boolean(operacionalCodigo))

  const [ordens, setOrdens] = useState<OrdemConsulta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<{ detectada: string; id: string } | null>(null)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchOrdens = useCallback(
    async (cursor?: { detectada: string; id: string }) => {
      if (minhasOrdens) return

      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (status) params.set('status', status)
        if (cursor) {
          params.set('cursor_detectada', cursor.detectada)
          params.set('cursor_id', cursor.id)
        }
        const res = await fetch(`/api/operacional/consultas?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('Erro ao carregar ordens')
        const data = (await res.json()) as ConsultasResponse
        if (cursor) {
          setOrdens((prev) => [...prev, ...data.ordens])
        } else {
          setOrdens(data.ordens)
        }
        setNextCursor(data.nextCursor)
        setHasMore(data.nextCursor !== null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido')
      } finally {
        setLoading(false)
      }
    },
    [q, status, minhasOrdens],
  )

  useEffect(() => {
    fetchOrdens()
  }, [fetchOrdens])

  return (
    <div className="space-y-4">
      {operacionalCodigo && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={minhasOrdens ? 'default' : 'outline'}
            size="sm"
            className="rounded-full"
            onClick={() => setMinhasOrdens(true)}
          >
            Minhas Ordens
          </Button>
          <Button
            type="button"
            variant={!minhasOrdens ? 'default' : 'outline'}
            size="sm"
            className="rounded-full"
            onClick={() => setMinhasOrdens(false)}
          >
            Consultar base
          </Button>
          {minhasOrdens && (
            <span className="text-xs text-muted-foreground">Cód. {operacionalCodigo}</span>
          )}
        </div>
      )}

      {minhasOrdens ? (
        saidaAtiva ? (
          <SaidaView saida={saidaAtiva} />
        ) : (
          <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
            Nenhuma saída atribuída no momento.
          </div>
        )
      ) : (
        <>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Ordem, nota, unidade, fornecedor..."
            className="pl-8 pr-8 h-9 text-sm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setQ('')
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select
          value={status || 'all'}
          onValueChange={(val) => setStatus(val === 'all' ? '' : val)}
        >
          <SelectTrigger className="w-[160px] h-9 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && ordens.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && !error && ordens.length === 0 && (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          Nenhuma ordem encontrada.
        </div>
      )}

      <div className="space-y-3">
        {ordens.map((ordem) => (
          <OrdemConsultaCard key={ordem.ordemId} ordem={ordem} />
        ))}
      </div>

      {hasMore && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => {
            if (nextCursor) fetchOrdens(nextCursor)
          }}
        >
          {loading ? 'Carregando...' : 'Carregar mais'}
        </Button>
      )}
        </>
      )}
    </div>
  )
}
