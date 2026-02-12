import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as never)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Vincular auth_user_id na tabela administradores
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        await supabase
          .from('administradores')
          .update({ auth_user_id: user.id })
          .eq('email', user.email)
      }

      return NextResponse.redirect(`${origin}/api/auth/landing`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
