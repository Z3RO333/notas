'use client'

import { useEffect } from 'react'

export function AdminDashboardRoutingBootstrap() {
  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const response = await fetch('/api/admin/orders/auto-routing', {
          method: 'POST',
          keepalive: true,
        })

        if (!response.ok && !cancelled) {
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
