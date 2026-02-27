import { NextResponse } from 'next/server'
import { authorizeSessionUser } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

async function signOutAndRedirect(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origin: string,
  errorCode?: 'auth' | 'unauthorized' | 'inactive' | 'conflict'
) {
  await supabase.auth.signOut()
  const redirectUrl = new URL('/login', origin)
  if (errorCode) {
    redirectUrl.searchParams.set('error', errorCode)
  }
  return NextResponse.redirect(redirectUrl)
}

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !user.id) {
    return NextResponse.redirect(`${origin}/login`)
  }

  try {
    const authorization = await authorizeSessionUser({
      id: user.id,
      email: user.email,
    })

    if (authorization.status !== 'authorized') {
      const errorCode =
        authorization.status === 'inactive'
          ? 'inactive'
          : authorization.status === 'conflict'
            ? 'conflict'
            : 'unauthorized'
      return signOutAndRedirect(supabase, origin, errorCode)
    }

    if (authorization.admin.role === 'gestor') {
      return NextResponse.redirect(`${origin}/admin`)
    }

    return NextResponse.redirect(`${origin}/`)
  } catch (error) {
    console.error('GET /api/auth/landing failed:', error)
    return signOutAndRedirect(supabase, origin, 'auth')
  }
}
