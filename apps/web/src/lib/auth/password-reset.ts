export const PASSWORD_RESET_RECOVERY_PATH = '/reset-password?type=recovery'
const DEFAULT_POST_AUTH_PATH = '/api/auth/landing'

function isSafeAppPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

export function buildPasswordResetRedirectTo(origin: string): string {
  const callbackUrl = new URL('/api/auth/callback', origin)
  callbackUrl.searchParams.set('next', PASSWORD_RESET_RECOVERY_PATH)
  return callbackUrl.toString()
}

export function resolvePostAuthRedirect(params: {
  authFlowType?: string | null
  nextPath?: string | null
}): string {
  const nextPath = (params.nextPath ?? '').trim()
  if (nextPath && isSafeAppPath(nextPath)) {
    return nextPath
  }

  if (params.authFlowType === 'recovery') {
    return PASSWORD_RESET_RECOVERY_PATH
  }

  return DEFAULT_POST_AUTH_PATH
}
