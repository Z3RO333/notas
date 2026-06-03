'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Clock3, ListChecks, Sparkles } from 'lucide-react'
import { CockpitKpiStrip, type CockpitKpiItem } from '@/components/cockpit/cockpit-kpi-strip'
import { updateSearchParams } from '@/lib/grid/query'
import type { CriticalityLevel, NotesKpiFilter } from '@/lib/types/database'

interface NotesKpiStripProps {
  total: number
  novas: number
  umDia: number
  doisMais: number
  activeKpi: NotesKpiFilter | null
  useNativeHistorySync?: boolean
}

function fmt(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function resolveCriticality(total: number, critical: number): CriticalityLevel {
  if (total <= 0 || critical <= 0) return 'saudavel'
  const ratio = critical / Math.max(total, 1)
  if (critical >= 20 || ratio >= 0.35) return 'critico'
  if (critical >= 6 || ratio >= 0.15) return 'atencao'
  return 'saudavel'
}

export function NotasKpiStrip({
  total,
  novas,
  umDia,
  doisMais,
  activeKpi,
  useNativeHistorySync = false,
}: NotesKpiStripProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const criticality = resolveCriticality(total, doisMais)
  const stripTone = criticality === 'critico' ? 'critical' : criticality === 'atencao' ? 'attention' : undefined

  function handleToggle(kpi: NotesKpiFilter) {
    const nextKpi = activeKpi === kpi ? null : kpi
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), {
      kpi: nextKpi,
    })
    const queryString = next.toString()
    const href = queryString ? `${pathname}?${queryString}` : pathname

    if (useNativeHistorySync && typeof window !== 'undefined') {
      window.history.replaceState(null, '', href)
      return
    }

    router.replace(href)
  }

  const items: CockpitKpiItem[] = [
    { id: 'notas', kpi: 'notas' as const, label: 'Notas', value: total, icon: ListChecks },
    { id: 'novas', kpi: 'novas' as const, label: 'Hoje', value: novas, icon: Sparkles },
    { id: 'um_dia', kpi: 'um_dia' as const, label: '1 dia', value: umDia, icon: Clock3 },
    { id: 'dois_mais', kpi: 'dois_mais' as const, label: '2+ dias', value: doisMais, icon: AlertTriangle },
  ].map((item) => ({
    id: item.id,
    label: item.label,
    value: fmt(item.value),
    icon: item.icon,
    active: activeKpi === item.kpi,
    helper: activeKpi === item.kpi ? 'Clique para limpar' : undefined,
    tone: item.kpi === 'dois_mais' && item.value > 0
      ? 'critical'
      : item.kpi === 'um_dia' && item.value > 0
        ? 'attention'
        : 'neutral',
    onClick: () => handleToggle(item.kpi),
  }))

  return <CockpitKpiStrip items={items} tone={stripTone} />
}
