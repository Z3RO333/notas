'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardThroughputPoint } from '@/lib/types/dashboard'

interface ThroughputTrendProps {
  data: DashboardThroughputPoint[]
  spanDays: number
  periodLabel: string
}

function toUtcDate(dayIso: string): Date | null {
  const parsed = new Date(`${dayIso}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function toDayIso(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekStartUtc(date: Date): Date {
  const day = date.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const start = new Date(date)
  start.setUTCDate(start.getUTCDate() + diff)
  return start
}

function aggregateWeekly(data: DashboardThroughputPoint[]): DashboardThroughputPoint[] {
  const byWeek = new Map<string, DashboardThroughputPoint>()

  for (const row of data) {
    const current = toUtcDate(row.dia)
    if (!current) continue
    const weekStart = getWeekStartUtc(current)
    const key = toDayIso(weekStart)
    const existing = byWeek.get(key)
    if (existing) {
      existing.qtd_entradas += row.qtd_entradas
      existing.qtd_concluidas += row.qtd_concluidas
      continue
    }

    byWeek.set(key, {
      dia: key,
      label: `Sem ${key.slice(8, 10)}/${key.slice(5, 7)}`,
      qtd_entradas: row.qtd_entradas,
      qtd_concluidas: row.qtd_concluidas,
    })
  }

  return Array.from(byWeek.values()).sort((a, b) => a.dia.localeCompare(b.dia))
}

function aggregateMonthly(data: DashboardThroughputPoint[]): DashboardThroughputPoint[] {
  const byMonth = new Map<string, DashboardThroughputPoint>()

  for (const row of data) {
    const monthKey = row.dia.slice(0, 7)
    const existing = byMonth.get(monthKey)
    if (existing) {
      existing.qtd_entradas += row.qtd_entradas
      existing.qtd_concluidas += row.qtd_concluidas
      continue
    }

    byMonth.set(monthKey, {
      dia: `${monthKey}-01`,
      label: `${monthKey.slice(5, 7)}/${monthKey.slice(2, 4)}`,
      qtd_entradas: row.qtd_entradas,
      qtd_concluidas: row.qtd_concluidas,
    })
  }

  return Array.from(byMonth.values()).sort((a, b) => a.dia.localeCompare(b.dia))
}

export function ThroughputTrend({ data, spanDays, periodLabel }: ThroughputTrendProps) {
  const chartData = useMemo(() => {
    if (spanDays <= 180) return data
    if (spanDays <= 730) return aggregateWeekly(data)
    return aggregateMonthly(data)
  }, [data, spanDays])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Tendencia de fluxo ({periodLabel})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" minTickGap={24} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="qtd_entradas"
                name="Entradas"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="qtd_concluidas"
                name="Concluídas"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
