import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardTeamCapacityRow } from '@/lib/types/dashboard'

interface TeamCapacityProps {
  rows: DashboardTeamCapacityRow[]
}

function getBarColor(mediaAbertas: number): string {
  if (mediaAbertas >= 20) return 'bg-red-600'
  if (mediaAbertas >= 14) return 'bg-amber-500'
  if (mediaAbertas >= 8) return 'bg-yellow-500'
  return 'bg-green-600'
}

export function TeamCapacity({ rows }: TeamCapacityProps) {
  const maxAbertas = rows.reduce((acc, row) => Math.max(acc, row.abertas), 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Carga por equipe</CardTitle>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Agora</span>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const barPercent = maxAbertas > 0 ? Math.round((row.abertas / maxAbertas) * 100) : 0
          return (
            <div key={row.especialidade} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{row.label}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {row.admins} admin{row.admins !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="font-medium">
                  {row.abertas} abertas · {row.media_abertas.toFixed(1)} por admin
                </p>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted">
                <div
                  className={`h-2.5 rounded-full transition-all ${getBarColor(row.media_abertas)}`}
                  style={{ width: `${Math.min(barPercent, 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
