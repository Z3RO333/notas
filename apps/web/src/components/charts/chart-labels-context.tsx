'use client'

import { createContext, useCallback, useContext, useState } from 'react'

interface ChartLabelsContextValue {
  showLabels: boolean
  toggle: () => void
}

const ChartLabelsContext = createContext<ChartLabelsContextValue>({
  showLabels: false,
  toggle: () => {},
})

export function ChartLabelsProvider({ children }: { children: React.ReactNode }) {
  const [showLabels, setShowLabels] = useState(false)
  const toggle = useCallback(() => setShowLabels((v) => !v), [])

  return (
    <ChartLabelsContext.Provider value={{ showLabels, toggle }}>
      {children}
    </ChartLabelsContext.Provider>
  )
}

export function useChartLabels() {
  return useContext(ChartLabelsContext)
}
