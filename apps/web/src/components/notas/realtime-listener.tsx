'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

const DEBOUNCE_MS = 1000
const TOAST_COOLDOWN_MS = 10_000

export function RealtimeListener() {
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastToastRef = useRef(0)

  useEffect(() => {
    function debouncedRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        router.refresh()

        const now = Date.now()
        if (now - lastToastRef.current > TOAST_COOLDOWN_MS) {
          lastToastRef.current = now
          toast({ title: 'Dados atualizados', variant: 'info' })
        }
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
  }, [supabase, router, toast])

  return null
}
