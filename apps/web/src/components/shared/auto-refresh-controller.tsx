'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AutoRefreshControllerProps {
  onRefresh: () => void
  defaultIntervalSec?: number
  intervalsSec?: number[]
}

export function AutoRefreshController({
  onRefresh,
  defaultIntervalSec = 30,
  intervalsSec = [15, 30, 60],
}: AutoRefreshControllerProps) {
  const [enabled, setEnabled] = useState(true)
  const [intervalSec, setIntervalSec] = useState(defaultIntervalSec)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      setRefreshing(true)
      onRefresh()
      setTimeout(() => setRefreshing(false), 800)
    }, intervalSec * 1000)

    return () => clearInterval(timer)
  }, [enabled, intervalSec, onRefresh])

  const statusLabel = useMemo(() => {
    if (!enabled) return 'Auto-refresh pausado'
    return `Auto-refresh ${intervalSec}s`
  }, [enabled, intervalSec])

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs text-muted-foreground">
      {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      <span>{statusLabel}</span>

      <select
        value={String(intervalSec)}
        onChange={(event) => setIntervalSec(Number(event.target.value))}
        className="h-7 rounded border bg-background px-1 text-xs"
        disabled={!enabled}
      >
        {intervalsSec.map((sec) => (
          <option key={sec} value={String(sec)}>{sec}s</option>
        ))}
      </select>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={() => setEnabled((prev) => !prev)}
      >
        {enabled ? (
          <>
            <PauseCircle className="mr-1 h-3.5 w-3.5" /> Pausar
          </>
        ) : (
          <>
            <PlayCircle className="mr-1 h-3.5 w-3.5" /> Retomar
          </>
        )}
      </Button>
    </div>
  )
}
