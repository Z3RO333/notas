'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const DEBOUNCE_MS = 1000

export function RealtimeListener() {
  const router = useRouter()
  const supabase = createClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function debouncedRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        router.refresh()
      }, DEBOUNCE_MS)
    }

    const channel = supabase
      .channel('notas-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notas_manutencao',
        },
        debouncedRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notas_historico',
        },
        debouncedRefresh
      )
      .subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [supabase, router])

  return null
}
