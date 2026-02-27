import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const authFlowType = searchParams.get('type')

  if (code) {
    const supabase = await createClient()

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      if (authFlowType === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password?type=recovery`)
      }

      return NextResponse.redirect(`${origin}/api/auth/landing`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
