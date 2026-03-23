/**
 * Rate limiter in-memory para endpoints públicos de auth.
 * Funciona por instância serverless (best-effort).
 * Para produção distribuída, substituir por @upstash/ratelimit + Redis.
 */

const WINDOW_MS = 15 * 60 * 1000 // 15 minutos
const MAX_ATTEMPTS = 5

interface Entry {
  count: number
  resetAt: number
}

const store = new Map<string, Entry>()

// Limpeza periódica para não acumular entradas expiradas em memória
let lastCleanup = Date.now()
function maybeCleanup() {
  const now = Date.now()
  if (now - lastCleanup < 60_000) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSecs: number } {
  maybeCleanup()
  const now = Date.now()
  const entry = store.get(ip)

  if (!entry || entry.resetAt <= now) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, retryAfterSecs: 0 }
  }

  entry.count += 1

  if (entry.count > MAX_ATTEMPTS) {
    const retryAfterSecs = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfterSecs }
  }

  return { allowed: true, retryAfterSecs: 0 }
}

export function getClientIp(request: Request): string {
  const headers = new Headers((request as Request & { headers: Headers }).headers)
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    'unknown'
  )
}
