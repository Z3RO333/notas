import { createHmac, timingSafeEqual } from 'crypto'
import type { UserRole } from '@/lib/types/database'

export const MVIEW_COOKIE_NAME = '__cockpit_mview'
export const MVIEW_COOKIE_MAX_AGE = 3600

interface MviewPayload {
  role: UserRole
  adminId: string
  email: string
  exp: number
}

function toBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('hex')
}

export function buildMviewToken(
  role: UserRole,
  adminId: string,
  email: string,
  secret: string,
): string {
  const exp = Math.floor(Date.now() / 1000) + MVIEW_COOKIE_MAX_AGE
  const payload: MviewPayload = { role, adminId, email, exp }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = sign(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export function verifyMviewToken(
  token: string,
  secret: string,
): { role: UserRole; adminId: string; email: string } | null {
  const dotIndex = token.lastIndexOf('.')
  if (dotIndex === -1) return null

  const encodedPayload = token.slice(0, dotIndex)
  const receivedSignature = token.slice(dotIndex + 1)

  const expectedSignature = sign(encodedPayload, secret)

  let signaturesMatch: boolean
  try {
    const receivedBuf = Buffer.from(receivedSignature, 'hex')
    const expectedBuf = Buffer.from(expectedSignature, 'hex')
    // HMAC-SHA256 hex = sempre 64 chars = 32 bytes
    if (receivedBuf.length !== 32 || expectedBuf.length !== 32) return null
    signaturesMatch = timingSafeEqual(receivedBuf, expectedBuf)
  } catch {
    return null
  }

  if (!signaturesMatch) return null

  let payload: MviewPayload
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as MviewPayload
  } catch {
    return null
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (payload.exp <= nowSeconds) return null

  if (
    typeof payload.role !== 'string' ||
    typeof payload.adminId !== 'string' ||
    typeof payload.email !== 'string'
  ) {
    return null
  }

  return { role: payload.role, adminId: payload.adminId, email: payload.email }
}
