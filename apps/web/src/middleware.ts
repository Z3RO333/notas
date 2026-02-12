import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Rotas publicas de auth
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as never)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (pathname === '/login') {
    if (!user?.email) {
      return NextResponse.next()
    }

    const { data: admin } = await supabase
      .from('administradores')
      .select('role')
      .eq('email', user.email)
      .single()

    const url = request.nextUrl.clone()
    url.pathname = admin?.role === 'gestor' ? '/admin' : '/'
    return NextResponse.redirect(url)
  }

  // Sem sessao em rota protegida → redireciona para login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Rotas /admin/* → verificar role = gestor
  if (pathname.startsWith('/admin')) {
    const { data: admin } = await supabase
      .from('administradores')
      .select('role')
      .eq('email', user.email)
      .single()

    if (!admin || admin.role !== 'gestor') {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
