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

  // Public auth routes stay reachable without a session.
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

  if (!admin.auth_user_id && pathname !== '/api/auth/landing') {
    const url = request.nextUrl.clone()
    url.pathname = '/api/auth/landing'
    return NextResponse.redirect(url)
  }

  if (pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = admin.role === 'gestor' ? '/admin' : '/'
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/admin') && admin.role !== 'gestor') {
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
