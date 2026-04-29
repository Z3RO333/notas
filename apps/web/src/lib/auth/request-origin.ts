export function getRequestOrigin(request: Request): string {
  const headers = request.headers as unknown as Headers
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
  const proto = headers.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}
