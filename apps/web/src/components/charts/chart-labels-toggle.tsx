'use client'

import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChartLabels } from './chart-labels-context'

export function ChartLabelsToggle() {
  const { showLabels, toggle } = useChartLabels()

  return (
    <Button variant="outline" size="sm" onClick={toggle}>
      {showLabels
        ? <EyeOff className="mr-2 h-4 w-4" />
        : <Eye className="mr-2 h-4 w-4" />}
      {showLabels ? 'Ocultar valores' : 'Mostrar valores'}
    </Button>
  )
}
