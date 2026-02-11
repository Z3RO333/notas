'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { atualizarStatusNota } from '@/lib/actions/nota-actions'
import type { NotaStatus } from '@/lib/types/database'

interface NotaActionsProps {
  notaId: string
  currentStatus: NotaStatus
  administradorId: string | null
}

const transitions: Record<NotaStatus, { value: NotaStatus; label: string }[]> = {
  nova: [
    { value: 'em_andamento', label: 'Iniciar Tratativa' },
    { value: 'cancelada', label: 'Cancelar' },
  ],
  em_andamento: [
    { value: 'encaminhada_fornecedor', label: 'Encaminhar ao Fornecedor' },
    { value: 'concluida', label: 'Concluir' },
    { value: 'cancelada', label: 'Cancelar' },
  ],
  encaminhada_fornecedor: [
    { value: 'concluida', label: 'Concluir' },
    { value: 'em_andamento', label: 'Retrabalho' },
    { value: 'cancelada', label: 'Cancelar' },
  ],
  concluida: [],
  cancelada: [],
}

export function NotaActions({ notaId, currentStatus, administradorId }: NotaActionsProps) {
  const router = useRouter()
  const [novoStatus, setNovoStatus] = useState<NotaStatus | ''>('')
  const [ordemGerada, setOrdemGerada] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableTransitions = transitions[currentStatus]

  if (availableTransitions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Acao</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Esta nota ja foi {currentStatus === 'concluida' ? 'concluida' : 'cancelada'}.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!administradorId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Acao</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Esta nota ainda nao foi atribuida a um tecnico.
          </p>
        </CardContent>
      </Card>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!novoStatus || !administradorId) return

    setLoading(true)
    setError('')

    try {
      await atualizarStatusNota({
        notaId,
        administradorId,
        novoStatus: novoStatus as 'em_andamento' | 'encaminhada_fornecedor' | 'concluida' | 'cancelada',
        ordemGerada: ordemGerada || undefined,
        fornecedorEncaminhado: fornecedor || undefined,
        observacoes: observacoes || undefined,
      })
      router.refresh()
      setNovoStatus('')
      setOrdemGerada('')
      setFornecedor('')
      setObservacoes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Atualizar Status</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Novo Status</label>
            <Select value={novoStatus} onValueChange={(v) => setNovoStatus(v as NotaStatus)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a acao..." />
              </SelectTrigger>
              <SelectContent>
                {availableTransitions.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(novoStatus === 'encaminhada_fornecedor' || novoStatus === 'concluida') && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Numero da Ordem Gerada</label>
                <Input
                  placeholder="Ex: 000400012345"
                  value={ordemGerada}
                  onChange={(e) => setOrdemGerada(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Fornecedor Encaminhado</label>
                <Input
                  placeholder="Nome do fornecedor"
                  value={fornecedor}
                  onChange={(e) => setFornecedor(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Observacoes</label>
            <Textarea
              placeholder="Observacoes sobre a tratativa..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={!novoStatus || loading}>
            {loading ? 'Salvando...' : 'Salvar Alteracao'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
