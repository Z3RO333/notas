'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { salvarConfigResponsavelPmpl } from '@/lib/actions/admin-actions'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

interface OwnerCandidate {
  id: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  ativo: boolean
}

interface AdminOrderTypeOwnerManagerProps {
  candidates: OwnerCandidate[]
  initialResponsavelId: string | null
  initialSubstitutoId: string | null
  configuredResponsavelNome: string | null
  configuredSubstitutoNome: string | null
  currentOwnerNome: string | null
  currentOwnerEmail: string | null
  currentOwnerStatus: string
  fallbackGestorNome: string | null
  configLoadError?: string | null
}

const EMPTY_SUBSTITUTE = '__none__'

export function AdminOrderTypeOwnerManager({
  candidates,
  initialResponsavelId,
  initialSubstitutoId,
  configuredResponsavelNome,
  configuredSubstitutoNome,
  currentOwnerNome,
  currentOwnerEmail,
  currentOwnerStatus,
  fallbackGestorNome,
  configLoadError,
}: AdminOrderTypeOwnerManagerProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const initialOwner = initialResponsavelId ?? candidates[0]?.id ?? ''
  const [responsavelId, setResponsavelId] = useState(initialOwner)
  const [substitutoId, setSubstitutoId] = useState(initialSubstitutoId ?? EMPTY_SUBSTITUTE)

  const ownerById = useMemo(() => new Map(candidates.map((item) => [item.id, item])), [candidates])

  function handleSave() {
    if (!responsavelId) {
      toast({ title: 'Selecione um responsável PMPL', variant: 'error' })
      return
    }

    startTransition(async () => {
      try {
        await salvarConfigResponsavelPmpl({
          responsavelId,
          substitutoId: substitutoId === EMPTY_SUBSTITUTE ? null : substitutoId,
        })

        toast({ title: 'Configuração PMPL salva', variant: 'success' })
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao salvar configuração PMPL',
          description: error instanceof Error ? error.message : 'Falha inesperada',
          variant: 'error',
        })
      }
    })
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-base font-semibold">Responsáveis por Tipo</h3>
        <p className="text-sm text-muted-foreground">
          Configure responsável e substituto para ordens PMPL com aplicação imediata.
        </p>
      </div>

      {configLoadError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {configLoadError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Responsável PMPL</label>
          <Select
            value={responsavelId}
            onValueChange={(value) => {
              setResponsavelId(value)
              if (value === substitutoId) setSubstitutoId(EMPTY_SUBSTITUTE)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o responsável" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.nome} ({candidate.role.toUpperCase()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Substituto PMPL</label>
          <Select value={substitutoId} onValueChange={setSubstitutoId}>
            <SelectTrigger>
              <SelectValue placeholder="Sem substituto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SUBSTITUTE}>Sem substituto</SelectItem>
              {candidates
                .filter((candidate) => candidate.id !== responsavelId)
                .map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.nome} ({candidate.role.toUpperCase()})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm">
        <p>
          <span className="font-medium">Responsável configurado:</span>{' '}
          {configuredResponsavelNome ?? ownerById.get(responsavelId)?.nome ?? 'Não definido'}
        </p>
        <p>
          <span className="font-medium">Substituto configurado:</span>{' '}
          {configuredSubstitutoNome ?? (substitutoId !== EMPTY_SUBSTITUTE ? ownerById.get(substitutoId)?.nome : 'Sem substituto') ?? 'Sem substituto'}
        </p>
        <p>
          <span className="font-medium">Responsável atual:</span>{' '}
          {currentOwnerNome ?? 'Sem responsável atual'}
          {currentOwnerEmail ? ` (${currentOwnerEmail})` : ''}
        </p>
        <p>
          <span className="font-medium">Status atual:</span> {currentOwnerStatus}
        </p>
        {fallbackGestorNome && (
          <p>
            <span className="font-medium">Fallback gestor:</span> {fallbackGestorNome}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={isPending || !responsavelId}>
          {isPending ? 'Salvando...' : 'Salvar configuração PMPL'}
        </Button>
      </div>
    </div>
  )
}
