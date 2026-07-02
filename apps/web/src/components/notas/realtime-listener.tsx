'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

const DEBOUNCE_MS = 5000
// Jitter espalha o refetch dos clientes conectados: sem ele, todo sync
// terminado dispara N clientes recarregando as queries pesadas no mesmo instante.
const JITTER_MAX_MS = 10_000
const TOAST_COOLDOWN_MS = 10_000

export function RealtimeListener() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastToastRef = useRef(0)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const queryClientRef = useRef(queryClient)
  const toastRef = useRef(toast)

  if (!supabaseRef.current) {
    supabaseRef.current = createClient()
  }

  useEffect(() => {
    queryClientRef.current = queryClient
  }, [queryClient])

  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  useEffect(() => {
    const supabase = supabaseRef.current
    if (!supabase) return

    function debouncedRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      const delay = DEBOUNCE_MS + Math.random() * JITTER_MAX_MS
      timerRef.current = setTimeout(() => {
        // Invalida as queries client-side dos painéis — router.refresh() aqui
        // re-executava o RSC inteiro (queries de segundos) e o resultado era
        // descartado, porque o conteúdo lê do cache do TanStack Query.
        void queryClientRef.current.invalidateQueries({ queryKey: ['notes-panel'] })
        void queryClientRef.current.invalidateQueries({ queryKey: ['orders-workspace'] })

        const now = Date.now()
        if (now - lastToastRef.current > TOAST_COOLDOWN_MS) {
          lastToastRef.current = now
          toastRef.current({ title: 'Dados atualizados', variant: 'info' })
        }
      }, delay)
    }

    const channel = supabase
      .channel('sync-trigger')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
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
