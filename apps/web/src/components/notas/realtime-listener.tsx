'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const POLL_INTERVAL_MS = 30_000

export function RealtimeListener() {
  const queryClient = useQueryClient()
  const queryClientRef = useRef(queryClient)

  useEffect(() => {
    queryClientRef.current = queryClient
  }, [queryClient])

  useEffect(() => {
    const interval = setInterval(() => {
      void queryClientRef.current.invalidateQueries({ queryKey: ['notes-panel'] })
      void queryClientRef.current.invalidateQueries({ queryKey: ['orders-workspace'] })
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [])

  return null
}
