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

  // Sem sessão e não esta em /login → redireciona para login
  if (!user) {
    if (pathname === '/login') return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Usuario autenticado — buscar role uma unica vez
  const needsRoleCheck = pathname === '/login' || pathname.startsWith('/admin')

  let adminRole: string | null = null
  if (needsRoleCheck && user.email) {
    const { data: admin } = await supabase
      .from('administradores')
      .select('role')
      .eq('email', user.email)
      .single()
    adminRole = admin?.role ?? null
  }

  // Já logado em /login → redirecionar para home
  if (pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = adminRole === 'gestor' ? '/admin' : '/'
    return NextResponse.redirect(url)
  }

  // Rotas /admin/* → verificar role = gestor
  if (pathname.startsWith('/admin') && adminRole !== 'gestor') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
