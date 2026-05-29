import Image from 'next/image'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { KpisNotasOrdens } from '@/lib/types/indicadores'

interface AdminPessoalCardProps {
  nome: string
  avatarUrl: string | null
  kpis: KpisNotasOrdens
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/15 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  )
}

function formatDias(valor: number | null): string {
  if (valor === null) return '—'
  return `${valor.toFixed(1).replace('.', ',')}d`
}

export function AdminPessoalCard({ nome, avatarUrl, kpis }: AdminPessoalCardProps) {
  const initials = nome
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <Card className="border-border/60 bg-card/70 shadow-sm">
      <CardHeader className="gap-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <div className="relative h-12 w-12 overflow-hidden rounded-full">
                <Image
                  src={avatarUrl}
                  alt={nome}
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-sm font-bold text-violet-600 dark:text-violet-300">
                {initials}
              </div>
            )}

            <div className="space-y-1">
              <CardTitle className="text-lg">{nome}</CardTitle>
              <p className="text-sm text-muted-foreground">
                Resumo da carteira no período selecionado.
              </p>
            </div>
          </div>

          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-600 dark:text-violet-300">
            Minha carteira
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Notas recebidas" value={kpis.total_notas.toLocaleString('pt-BR')} />
        <Stat label="Convertidas" value={kpis.notas_convertidas.toLocaleString('pt-BR')} />
        <Stat
          label="Taxa conversão"
          value={`${kpis.taxa_conversao.toFixed(1).replace('.', ',')}%`}
        />
        <Stat label="T. médio nota->ordem" value={formatDias(kpis.tempo_medio_nota_ordem)} />
        <Stat label="T. conclusão (mediana)" value={formatDias(kpis.tempo_medio_conclusao)} />
        <Stat label="Ordens concluídas" value={kpis.total_ordens_concluidas.toLocaleString('pt-BR')} />
      </CardContent>
    </Card>
  )
}
