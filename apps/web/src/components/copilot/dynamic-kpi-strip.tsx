'use client'

import type { DynamicKpiItem } from '@/lib/types/copilot'

interface DynamicKpiStripProps {
  items: DynamicKpiItem[]
}

const TONE_CLASSES = {
  neutral: 'border-border',
  success: 'border-emerald-200 bg-emerald-50/50',
  warning: 'border-amber-200 bg-amber-50/50',
  danger: 'border-red-200 bg-red-50/50',
}

const TONE_VALUE_CLASSES = {
  neutral: 'text-foreground',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
}

export function DynamicKpiStrip({ items }: DynamicKpiStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border p-3 transition-all ${TONE_CLASSES[item.tone]} ${item.pulse ? 'animate-pulse' : ''}`}
        >
          <p className="text-xs text-muted-foreground truncate">{item.label}</p>
          <p className={`text-2xl font-bold mt-0.5 ${TONE_VALUE_CLASSES[item.tone]}`}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  )
}
