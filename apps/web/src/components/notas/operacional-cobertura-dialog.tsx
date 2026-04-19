'use client'

import { useMemo, useState } from 'react'
import { HardHat, Loader2, MapPin } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface OperacionalRow {
  codigo: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  unidades: Array<{ unidade: string; grupo_nome: string | null }>
}

function groupByGrupo(unidades: OperacionalRow['unidades']) {
  const groups = new Map<string, string[]>()
  for (const u of unidades) {
    const key = u.grupo_nome ?? ''
    const existing = groups.get(key) ?? []
    existing.push(u.unidade)
    groups.set(key, existing)
  }
  return groups
}

async function fetchCobertura(supabase: ReturnType<typeof createClient>): Promise<OperacionalRow[]> {
  const [opResult, unidadesResult] = await Promise.all([
    supabase
      .from('dim_operacionais')
      .select('codigo, nome, avatar_url, especialidade')
      .eq('ativo', true)
      .order('nome'),
    supabase
      .from('operacional_unidades')
      .select('operacional_codigo, unidade, grupo_nome')
      .order('grupo_nome')
      .order('unidade'),
  ])

  if (opResult.error) throw opResult.error

  const unidadesByCode = new Map<string, Array<{ unidade: string; grupo_nome: string | null }>>()
  for (const u of (unidadesResult.data ?? [])) {
    const existing = unidadesByCode.get(u.operacional_codigo) ?? []
    existing.push({ unidade: u.unidade, grupo_nome: u.grupo_nome })
    unidadesByCode.set(u.operacional_codigo, existing)
  }

  return (opResult.data ?? [])
    .map((op) => ({
      codigo: op.codigo,
      nome: op.nome,
      avatar_url: op.avatar_url ?? null,
      especialidade: op.especialidade ?? null,
      unidades: unidadesByCode.get(op.codigo) ?? [],
    }))
    .filter((op) => op.unidades.length > 0)
}

interface OperacionalCoberturaDialogProps {
  className?: string
}

export function OperacionalCoberturaDialog({ className }: OperacionalCoberturaDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [operacionais, setOperacionais] = useState<OperacionalRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setLoading(true)
      setError(null)
      fetchCobertura(supabase)
        .then(setOperacionais)
        .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar cobertura'))
        .finally(() => setLoading(false))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn('w-full xl:w-auto', className)}>
          <HardHat className="mr-2 h-3.5 w-3.5" />
          Cobertura
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cobertura Operacional</DialogTitle>
          <DialogDescription>
            Lojas atendidas por cada operacional ativo. Atualiza automaticamente quando o gestor faz alterações.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && !error && operacionais.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum operacional com lojas configuradas.
          </p>
        )}

        {!loading && !error && operacionais.length > 0 && (
          <div className="space-y-4 pt-2">
            {operacionais.map((op) => {
              const grupos = groupByGrupo(op.unidades)
              return (
                <div key={op.codigo} className="rounded-xl border bg-card">
                  <div className="flex items-center gap-3 border-b px-4 py-3">
                    <Avatar src={op.avatar_url} nome={op.nome} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{op.nome}</p>
                      {op.especialidade && (
                        <p className="text-xs text-muted-foreground">{op.especialidade}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {op.unidades.length} {op.unidades.length === 1 ? 'loja' : 'lojas'}
                    </span>
                  </div>

                  <div className="space-y-2 p-4">
                    {Array.from(grupos.entries()).map(([grupoNome, lojas]) => (
                      <div key={grupoNome || '_'} className="space-y-1">
                        {grupoNome && (
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {grupoNome}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {lojas.map((loja) => (
                            <div
                              key={loja}
                              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-sm"
                            >
                              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                              {loja}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
