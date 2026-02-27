import { NextResponse } from 'next/server'
import { provisionFirstAccessUser } from '@/lib/auth/server'
import { mapRegisterErrorMessage } from '@/lib/auth/shared'

export async function POST(request: Request) {
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
      const status =
        result.code === 'INVALID_DOMAIN' ||
        result.code === 'INVALID_PASSWORD' ||
        result.code === 'PASSWORD_MISMATCH'
          ? 400
          : result.code === 'ACCOUNT_ALREADY_ACTIVE' || result.code === 'EMAIL_CONFLICT'
            ? 409
            : result.code === 'UNAUTHORIZED_EMAIL' ||
                result.code === 'INACTIVE_USER' ||
                result.code === 'ROLE_NOT_ALLOWED'
              ? 403
              : 500

      return NextResponse.json(
        {
          ok: false,
          code: result.code,
          message: mapRegisterErrorMessage(result.code),
        },
        { status }
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
