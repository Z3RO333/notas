'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

const DEBOUNCE_MS = 1000
const TOAST_COOLDOWN_MS = 10_000

export function RealtimeListener() {
  const router = useRouter()
  const { toast } = useToast()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastToastRef = useRef(0)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const routerRef = useRef(router)
  const toastRef = useRef(toast)

  if (!supabaseRef.current) {
    supabaseRef.current = createClient()
  }

  useEffect(() => {
    routerRef.current = router
  }, [router])

  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  useEffect(() => {
    const supabase = supabaseRef.current
    if (!supabase) return

    function debouncedRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        routerRef.current.refresh()

        const now = Date.now()
        if (now - lastToastRef.current > TOAST_COOLDOWN_MS) {
          lastToastRef.current = now
          toastRef.current({ title: 'Dados atualizados', variant: 'info' })
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
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_log',
        },
        debouncedRefresh
      )
      .subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [])

  return null
}
