'use client'

import { useReportWebVitals } from 'next/web-vitals'

export function WebVitalsBridge() {
  useReportWebVitals((metric) => {
    const payload = JSON.stringify({
      ...metric,
      page: window.location.pathname,
    })

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      navigator.sendBeacon('/api/rum', blob)
      return
    }

    void fetch('/api/rum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
  })

  return null
}
