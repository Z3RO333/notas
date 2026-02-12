import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardTeamCapacityRow } from '@/lib/types/dashboard'

interface TeamCapacityProps {
  rows: DashboardTeamCapacityRow[]
}

function getBarColor(utilizacao: number): string {
  if (utilizacao >= 1) return 'bg-red-600'
  if (utilizacao >= 0.85) return 'bg-amber-500'
  if (utilizacao >= 0.6) return 'bg-yellow-500'
  return 'bg-green-600'
}

export function TeamCapacity({ rows }: TeamCapacityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Capacidade por equipe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const percent = Math.round(row.utilizacao * 100)
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
                  {row.abertas}/{row.capacidade} ({percent}%)
                </p>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted">
                <div
                  className={`h-2.5 rounded-full transition-all ${getBarColor(row.utilizacao)}`}
                  style={{ width: `${Math.min(percent, 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
