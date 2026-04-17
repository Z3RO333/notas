import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { KpisNotasOrdens } from '@/lib/types/indicadores'

interface AdminPessoalCardProps {
  nome: string
  avatarUrl: string | null
  kpis: KpisNotasOrdens
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
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
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={nome} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
              {initials}
            </div>
          )}
          <div>
            <CardTitle className="text-base">{nome}</CardTitle>
            <p className="text-xs text-muted-foreground">Minha carteira no período</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          <Stat label="Notas recebidas" value={kpis.total_notas.toLocaleString('pt-BR')} />
          <Stat label="Convertidas" value={kpis.notas_convertidas.toLocaleString('pt-BR')} />
          <Stat
            label="Taxa conversão"
            value={`${kpis.taxa_conversao.toFixed(1).replace('.', ',')}%`}
          />
          <Stat label="T. médio nota→ordem" value={formatDias(kpis.tempo_medio_nota_ordem)} />
          <Stat label="T. médio conclusão" value={formatDias(kpis.tempo_medio_conclusao)} />
          <Stat label="Ordens concluídas" value={kpis.total_ordens_concluidas.toLocaleString('pt-BR')} />
        </div>
      </CardContent>
    </Card>
  )
}
