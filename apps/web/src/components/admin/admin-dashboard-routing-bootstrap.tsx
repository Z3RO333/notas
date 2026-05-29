'use client'

import { useEffect } from 'react'

const THROTTLE_STORAGE_KEY = 'cockpit:admin:auto-routing:lastRun'
const THROTTLE_WINDOW_MS = 10 * 60_000 // 10min — operação pesada de banco, não precisa rodar a cada navegação

function shouldSkipDueToThrottle(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(THROTTLE_STORAGE_KEY)
    if (!raw) return false
    const last = Number(raw)
    if (!Number.isFinite(last)) return false
    return Date.now() - last < THROTTLE_WINDOW_MS
  } catch {
    return false
  }
}

function markCompleted() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THROTTLE_STORAGE_KEY, String(Date.now()))
  } catch {
    // localStorage indisponível é tolerável — throttle volta a permitir
  }
}

export function AdminDashboardRoutingBootstrap() {
  useEffect(() => {
    if (shouldSkipDueToThrottle()) return

    let cancelled = false

    async function run() {
      try {
        const response = await fetch('/api/admin/orders/auto-routing', {
          method: 'POST',
          keepalive: true,
        })

        if (cancelled) return

        if (response.ok) {
          markCompleted()
        } else {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          console.error('[admin/auto-routing] request failed:', payload.error ?? response.statusText)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[admin/auto-routing] request failed:', error)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
