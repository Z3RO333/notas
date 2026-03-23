import { NextResponse } from 'next/server'
import { provisionFirstAccessUser } from '@/lib/auth/server'
import { mapRegisterErrorMessage } from '@/lib/auth/shared'
import { checkRateLimit, getClientIp } from '@/lib/auth/rate-limit'

// Mensagem genérica para erros que revelam existência de conta
const GENERIC_UNAUTHORIZED_MESSAGE = 'Email não autorizado ou conta já existente. Contate o gestor.'

export async function POST(request: Request) {
  // Rate limiting por IP: 5 tentativas por 15 minutos
  const ip = getClientIp(request)
  const { allowed, retryAfterSecs } = checkRateLimit(ip)

  if (!allowed) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSecs) },
      }
    )
  }

  try {
    const body = (await request.json()) as {
      email?: string
      password?: string
      confirmPassword?: string
    }

    const result = await provisionFirstAccessUser({
      email: body.email ?? '',
      password: body.password ?? '',
      confirmPassword: body.confirmPassword ?? '',
    })

    if (!result.ok) {
      // Erros de validação de input: retornam detalhes (não revelam dados de conta)
      if (
        result.code === 'INVALID_DOMAIN' ||
        result.code === 'INVALID_PASSWORD' ||
        result.code === 'PASSWORD_MISMATCH'
      ) {
        return NextResponse.json(
          { ok: false, code: result.code, message: mapRegisterErrorMessage(result.code) },
          { status: 400 }
        )
      }

      // Erros que revelam existência/estado da conta: resposta genérica unificada
      // (UNAUTHORIZED_EMAIL, INACTIVE_USER, ROLE_NOT_ALLOWED, ACCOUNT_ALREADY_ACTIVE, EMAIL_CONFLICT)
      return NextResponse.json(
        { ok: false, code: 'UNAUTHORIZED', message: GENERIC_UNAUTHORIZED_MESSAGE },
        { status: 403 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/auth/register failed:', error)
    return NextResponse.json(
      {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: mapRegisterErrorMessage('INTERNAL_ERROR'),
      },
      { status: 500 }
    )
  }
}
