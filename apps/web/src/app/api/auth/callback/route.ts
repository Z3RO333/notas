import { NextResponse } from 'next/server'
import { resolvePostAuthRedirect } from '@/lib/auth/password-reset'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const authFlowType = searchParams.get('type')
  const nextPath = searchParams.get('next')

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
