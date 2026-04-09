'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { salvarEscalaDistribuicaoSabado } from '@/lib/actions/admin-actions'
import {
  SATURDAY_SCHEDULE_QUERY_PARAM,
  validateSaturdayScheduleEntries,
  type SaturdayScheduleCandidate,
  type SaturdayScheduleSlot,
} from '@/lib/admin/saturday-distribution-schedule'
import { updateSearchParams } from '@/lib/grid/query'
import type { SaturdayDistributionScheduleEntryInput } from '@/lib/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

interface AdminSaturdayScheduleManagerProps {
  selectedMonthKey: string
  candidates: SaturdayScheduleCandidate[]
  slots: SaturdayScheduleSlot[]
}

interface SaturdayScheduleDraft extends SaturdayDistributionScheduleEntryInput {
  label: string
}

function toDraft(slots: SaturdayScheduleSlot[]): SaturdayScheduleDraft[] {
  return slots.map((slot) => ({
    data_escala: slot.data_escala,
    label: slot.label,
    hora_fim: slot.hora_fim || '',
    administrador_ids: [...slot.administrador_ids],
  }))
}

function buildSummary(slot: SaturdayScheduleDraft, candidateById: Map<string, SaturdayScheduleCandidate>): string {
  if (slot.administrador_ids.length === 0) {
    return 'Sem escala programada para este sabado.'
  }

  const names = slot.administrador_ids
    .map((id) => candidateById.get(id)?.nome)
    .filter((value): value is string => Boolean(value))

  return `${names.join(', ')} ate ${slot.hora_fim || '--:--'}.`
}

export function AdminSaturdayScheduleManager({
  selectedMonthKey,
  candidates,
  slots,
}: AdminSaturdayScheduleManagerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [draftSlots, setDraftSlots] = useState<SaturdayScheduleDraft[]>(() => toDraft(slots))

  useEffect(() => {
    setDraftSlots(toDraft(slots))
  }, [slots])

  const candidateById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  )

  const configuredCount = draftSlots.filter((slot) => slot.administrador_ids.length > 0).length

  function updateSlot(dateKey: string, updater: (slot: SaturdayScheduleDraft) => SaturdayScheduleDraft) {
    setDraftSlots((current) => current.map((slot) => (slot.data_escala === dateKey ? updater(slot) : slot)))
  }

  function handleMonthChange(nextMonthKey: string) {
    const next = updateSearchParams(
      new URLSearchParams(searchParams.toString()),
      { [SATURDAY_SCHEDULE_QUERY_PARAM]: nextMonthKey },
    )
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function toggleParticipant(dateKey: string, adminId: string, checked: boolean) {
    updateSlot(dateKey, (slot) => {
      const currentIds = new Set(slot.administrador_ids)
      if (checked) {
        currentIds.add(adminId)
      } else {
        currentIds.delete(adminId)
      }

      return {
        ...slot,
        administrador_ids: Array.from(currentIds).sort(),
      }
    })
  }

  function handleSave() {
    const entries = draftSlots.map((slot) => ({
      data_escala: slot.data_escala,
      hora_fim: slot.hora_fim || null,
      administrador_ids: slot.administrador_ids,
    }))

    const errors = validateSaturdayScheduleEntries(selectedMonthKey, entries)
    if (errors.length > 0) {
      toast({
        title: 'Escala de sabado incompleta',
        description: errors[0],
        variant: 'error',
      })
      return
    }

    startTransition(async () => {
      try {
        await salvarEscalaDistribuicaoSabado({
          monthKey: selectedMonthKey,
          entries,
        })

        toast({
          title: 'Escala de sabado salva',
          description: `${configuredCount} sabado(s) configurado(s) para ${selectedMonthKey}.`,
          variant: 'success',
        })
        router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao salvar escala de sabado',
          description: error instanceof Error ? error.message : 'Falha inesperada',
          variant: 'error',
        })
      }
    })
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold">Escala de Sabado</h3>
          <p className="text-sm text-muted-foreground">
            O gestor define, por sabado do mes, quem recebe notas novas do pool geral ate o horario informado.
          </p>
        </div>

        <div className="w-full max-w-52 space-y-2">
          <label htmlFor="saturday-schedule-month" className="text-sm font-medium">Mes da escala</label>
          <Input
            id="saturday-schedule-month"
            type="month"
            value={selectedMonthKey}
            disabled={isPending}
            onChange={(event) => handleMonthChange(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Sabados no mes: </span>
          <span className="font-semibold">{draftSlots.length}</span>
        </div>
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Sabados configurados: </span>
          <span className="font-semibold">{configuredCount}</span>
        </div>
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Candidatos do pool geral: </span>
          <span className="font-semibold">{candidates.length}</span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        A janela sempre comeca 00:00 de sabado no horario de Manaus. Apos o horario final, a distribuicao geral volta ao fluxo normal.
      </p>

      {candidates.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Nenhum administrador do pool geral foi encontrado para programar a escala.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {draftSlots.map((slot) => {
            const requiresTime = slot.administrador_ids.length > 0 && !slot.hora_fim

            return (
              <Card
                key={slot.data_escala}
                className={requiresTime ? 'border-amber-300 dark:border-amber-800' : undefined}
              >
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{slot.label}</CardTitle>
                      <CardDescription>
                        Escala valida para notas novas do pool geral durante a janela configurada.
                      </CardDescription>
                    </div>
                    <Badge variant={slot.administrador_ids.length > 0 ? 'secondary' : 'outline'}>
                      {slot.administrador_ids.length > 0 ? `${slot.administrador_ids.length} participante(s)` : 'Sem escala'}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor={`hora-fim-${slot.data_escala}`} className="text-sm font-medium">Valido ate</label>
                    <Input
                      id={`hora-fim-${slot.data_escala}`}
                      type="time"
                      value={slot.hora_fim ?? ''}
                      disabled={isPending}
                      onChange={(event) => updateSlot(slot.data_escala, (current) => ({
                        ...current,
                        hora_fim: event.target.value,
                      }))}
                    />
                    {requiresTime && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Informe o horario final para ativar este sabado.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Participantes do pool geral</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {candidates.map((candidate) => {
                        const checked = slot.administrador_ids.includes(candidate.id)

                        return (
                          <label
                            key={`${slot.data_escala}-${candidate.id}`}
                            className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm ${checked ? 'border-primary bg-primary/5' : ''}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={checked}
                              disabled={isPending}
                              onChange={(event) => toggleParticipant(slot.data_escala, candidate.id, event.target.checked)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">{candidate.nome}</span>
                              <span className="block truncate text-xs text-muted-foreground">{candidate.email}</span>
                              <span className="mt-2 flex flex-wrap gap-2">
                                {!candidate.ativo && (
                                  <Badge variant="outline" className="text-[10px]">Inativo</Badge>
                                )}
                                {candidate.em_ferias && (
                                  <Badge variant="outline" className="text-[10px]">Ferias</Badge>
                                )}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <span className="font-medium">Resumo:</span>{' '}
                    {buildSummary(slot, candidateById)}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={isPending || candidates.length === 0}>
          {isPending ? 'Salvando...' : 'Salvar escala do mes'}
        </Button>
      </div>
    </div>
  )
}
