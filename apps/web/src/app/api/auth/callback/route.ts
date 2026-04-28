import { NextResponse } from 'next/server'
import { resolvePostAuthRedirect } from '@/lib/auth/password-reset'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const authFlowType = searchParams.get('type')
  const nextPath = searchParams.get('next')

  const headers = request.headers as unknown as Headers
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
  const proto = headers.get('x-forwarded-proto') ?? 'http'
  const origin = `${proto}://${host}`

  if (code) {
    const supabase = await createClient()

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const redirectPath = resolvePostAuthRedirect({
        authFlowType,
        nextPath,
      })
      return NextResponse.redirect(`${origin}${redirectPath}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
