import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isMaintainerEmail } from '@/lib/auth/shared'
import { buildMviewToken, MVIEW_COOKIE_NAME, MVIEW_COOKIE_MAX_AGE } from '@/lib/auth/maintainer-view'
import { logger } from '@/lib/logger'

const ElevateBodySchema = z.object({
  role: z.enum(['gestor', 'admin', 'viewer']),
})

export async function POST(request: Request) {
  const secret = process.env.MAINTAINER_SESSION_SECRET
  if (!secret) {
    logger.error('[maintainer/elevate] MAINTAINER_SESSION_SECRET nao configurado')
    return NextResponse.json({ error: 'Configuracao do servidor ausente' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!isMaintainerEmail(user.email)) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body invalido' }, { status: 400 })
  }

  const parsed = ElevateBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Role invalido', details: parsed.error.flatten() }, { status: 400 })
  }

  const { role } = parsed.data

  const { data: admin, error: adminError } = await supabase
    .from('administradores')
    .select('id')
    .eq('email', user.email)
    .single()

  if (adminError || !admin) {
    logger.error('[maintainer/elevate] administrador nao encontrado para email:', user.email)
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  const token = buildMviewToken(role, admin.id, user.email, secret)
  const expiresAt = new Date(Date.now() + MVIEW_COOKIE_MAX_AGE * 1000).toISOString()

  // Auditoria é best-effort — falha não deve bloquear a operação
  const { error: auditError } = await supabase.from('admin_audit_log').insert({
    gestor_id: admin.id,
    acao: 'MAINTAINER_VIEW_ATIVADO',
    alvo_id: null,
    detalhes: { role_simulado: role, email: user.email, exp: expiresAt },
  })

  if (auditError) {
    logger.error('[maintainer/elevate] falha ao registrar auditoria:', auditError.message)
  }

  const cookieStore = await cookies()
  cookieStore.set(MVIEW_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MVIEW_COOKIE_MAX_AGE,
    path: '/',
  })

  return NextResponse.json({ ok: true, role, expiresAt })
}

export async function DELETE() {
  const secret = process.env.MAINTAINER_SESSION_SECRET
  if (!secret) {
    logger.error('[maintainer/elevate] MAINTAINER_SESSION_SECRET nao configurado')
    return NextResponse.json({ error: 'Configuracao do servidor ausente' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!isMaintainerEmail(user.email)) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { data: admin, error: adminError } = await supabase
    .from('administradores')
    .select('id')
    .eq('email', user.email)
    .single()

  if (adminError || !admin) {
    logger.error('[maintainer/elevate] administrador nao encontrado para email:', user.email)
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  // Auditoria é best-effort — falha não deve bloquear a operação
  const { error: auditError } = await supabase.from('admin_audit_log').insert({
    gestor_id: admin.id,
    acao: 'MAINTAINER_VIEW_DESATIVADO',
    alvo_id: null,
    detalhes: { email: user.email },
  })

  if (auditError) {
    logger.error('[maintainer/elevate] falha ao registrar auditoria de desativacao:', auditError.message)
  }

  const cookieStore = await cookies()
  cookieStore.set(MVIEW_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  return NextResponse.json({ ok: true })
}
