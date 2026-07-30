import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedAuthRole, normalizeEmail } from '@/lib/auth/shared'

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

  const session = await auth()
  const email = normalizeEmail(session?.user?.email ?? '')

  if (!email) {
    if (pathname === '/login') return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('vw_administrador_por_email')
    .select('role, ativo')
    .eq('email', email)
    .maybeSingle()

  if (!admin || !isAllowedAuthRole(admin.role)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(url)
  }

  if (!admin.ativo) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'inactive')
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
      pathname.startsWith('/api/operacional')
    if (!isAllowed) {
      const url = request.nextUrl.clone()
      url.pathname = '/operacional/consultas'
      url.search = ''
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
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

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
