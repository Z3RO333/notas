const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 150

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  const status = (error as { status?: number }).status
  // Retry on network/timeout errors and 5xx from Supabase, never on 4xx (auth, not found, etc.)
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  if (code === 'PGRST301') return false // JWT expired — not retryable
  return true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  let lastResult: { data: T | null; error: unknown } = { data: null, error: null }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    lastResult = await fn()

    if (!lastResult.error || !isRetryable(lastResult.error)) {
      return lastResult
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      // Exponential backoff with ±20% jitter
      const base = BASE_DELAY_MS * 2 ** attempt
      const jitter = base * 0.2 * (Math.random() * 2 - 1)
      await delay(Math.round(base + jitter))
    }
  }

  return lastResult
}
