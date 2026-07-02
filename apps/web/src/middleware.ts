import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedAuthRole, normalizeEmail } from '@/lib/auth/shared'

function copySupabaseCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach(({ name, value, ...options }) => {
    target.cookies.set(name, value, options)
  })
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — no session required.
  // /api/radar/alerta-pintura é chamada por cron sem cookie de sessão;
  // a autorização real é o CRON_SECRET validado dentro do handler.
  if (
    pathname.startsWith('/api/auth')
    || pathname === '/api/health'
    || pathname === '/api/radar/alerta-pintura'
  ) {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
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

  if (!user) {
    if (pathname === '/login') return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const normalizedEmail = normalizeEmail(user.email ?? '')
  if (!normalizedEmail) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'unauthorized')
    const redirectResponse = NextResponse.redirect(url)
    copySupabaseCookies(supabaseResponse, redirectResponse)
    return redirectResponse
  }

  const { data: admin } = await supabase
    .from('administradores')
    .select('role, ativo, auth_user_id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (!admin || !isAllowedAuthRole(admin.role)) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'unauthorized')
    const redirectResponse = NextResponse.redirect(url)
    copySupabaseCookies(supabaseResponse, redirectResponse)
    return redirectResponse
  }

  if (!admin.ativo) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'inactive')
    const redirectResponse = NextResponse.redirect(url)
    copySupabaseCookies(supabaseResponse, redirectResponse)
    return redirectResponse
  }

  if (admin.auth_user_id && admin.auth_user_id !== user.id) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'conflict')
    const redirectResponse = NextResponse.redirect(url)
    copySupabaseCookies(supabaseResponse, redirectResponse)
    return redirectResponse
  }

  if (!admin.auth_user_id && pathname !== '/api/auth/landing' && pathname !== '/reset-password') {
    const url = request.nextUrl.clone()
    url.pathname = '/api/auth/landing'
    return NextResponse.redirect(url)
  }

  if (pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname =
      admin.role === 'gestor'
        ? '/admin'
        : admin.role === 'viewer'
          ? '/ordens'
          : admin.role === 'operacional'
            ? '/operacional/consultas'
            : '/'
    return NextResponse.redirect(url)
  }

  if (admin.role === 'operacional') {
    const isAllowed =
      pathname.startsWith('/operacional') ||
      pathname.startsWith('/api/operacional') ||
      pathname === '/api/auth/landing' ||
      pathname === '/reset-password'
    if (!isAllowed) {
      const url = request.nextUrl.clone()
      url.pathname = '/operacional/consultas'
      url.search = ''
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (pathname.startsWith('/admin') && admin.role !== 'gestor') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  if (admin.role === 'viewer') {
    const isNotesPage = pathname === '/' || pathname.startsWith('/notas/')
    const isOrdersPage = pathname === '/ordens' || pathname.startsWith('/ordens/')
    const isOrdersApi = pathname.startsWith('/api/ordens')

    if (!isNotesPage && !isOrdersPage && !isOrdersApi) {
      const url = request.nextUrl.clone()
      url.pathname = '/ordens'
      url.search = ''
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
