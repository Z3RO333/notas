import 'server-only'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { applyAutomaticOrdersRouting } from '@/lib/orders/pmpl-routing'
import { MAINTAINER_EMAILS } from '@/lib/auth/shared'
import type { UserRole } from '@/lib/types/database'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

interface LoggedAdminRow {
  id: string
  role: UserRole
}

export interface AuthenticatedAdminActionContext {
  supabase: SupabaseServerClient
  admin: LoggedAdminRow
}

export function revalidateCockpitPaths() {
  // Carga por admin é cacheada 60s (get-notes-panel-data) — mutações que
  // mexem em atribuição/disponibilidade precisam refletir na hora.
  revalidateTag('carga-admins')
  revalidatePath('/', 'layout')
  revalidatePath('/admin', 'layout')
  revalidatePath('/ordens', 'layout')
  revalidatePath('/notas', 'layout')
}

export async function getAuthenticatedAdminActionContext(): Promise<AuthenticatedAdminActionContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) throw new Error('Nao autenticado')

  const { data: admin } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (!admin || (admin.role !== 'admin' && admin.role !== 'gestor')) {
    throw new Error('Administrador nao encontrado')
  }

  return {
    supabase,
    admin,
  }
}

export async function getGestorActionContext(): Promise<AuthenticatedAdminActionContext> {
  const context = await getAuthenticatedAdminActionContext()
  if (context.admin.role !== 'gestor') throw new Error('Sem permissao')
  return context
}

export async function getGestorOrMaintainerActionContext(): Promise<AuthenticatedAdminActionContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) throw new Error('Nao autenticado')

  const { data: admin } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (!admin || (admin.role !== 'admin' && admin.role !== 'gestor')) {
    throw new Error('Administrador nao encontrado')
  }

  const isGestor = admin.role === 'gestor'
  const isMaintainer = MAINTAINER_EMAILS.has(user.email.toLowerCase())

  if (!isGestor && !isMaintainer) throw new Error('Sem permissao')

  return { supabase, admin }
}

export async function writeAdminAuditLog(params: {
  supabase: SupabaseServerClient
  gestorId: string
  acao: string
  alvoId: string | null
  detalhes?: Record<string, unknown>
}) {
  const { error } = await params.supabase.from('admin_audit_log').insert({
    gestor_id: params.gestorId,
    acao: params.acao,
    alvo_id: params.alvoId,
    detalhes: params.detalhes ?? null,
  })

  if (error) {
    console.error('Falha ao gravar admin_audit_log:', error.message)
  }
}

export function isDebugOrdersRoutingEnabled(): boolean {
  return process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1'
}

export async function runBestEffortAutomaticOrdersRouting(params: {
  supabase: SupabaseServerClient
  gestorId: string
  motivo: string
  errorPrefix: string
}) {
  try {
    await applyAutomaticOrdersRouting({
      supabase: params.supabase,
      gestorId: params.gestorId,
      debug: isDebugOrdersRoutingEnabled(),
      motivo: params.motivo,
    })
  } catch (routingError) {
    console.error(params.errorPrefix, routingError)
  }
}

export async function runBestEffortVacationCoverageRedistribution(params: {
  supabase: SupabaseServerClient
  gestorId: string
  adminOrigemId: string
  motivo: string
  errorPrefix: string
}) {
  try {
    const { error } = await params.supabase.rpc('redistribuir_carteira_ferias', {
      p_admin_origem: params.adminOrigemId,
      p_gestor_id: params.gestorId,
      p_motivo: params.motivo,
    })

    if (error) {
      if (isMissingRpcFunctionError(error, 'redistribuir_carteira_ferias')) {
        console.warn('RPC redistribuir_carteira_ferias nao encontrada. Pulando redistribuicao automatica de ferias.')
        return
      }

      throw new Error(error.message)
    }
  } catch (redistributionError) {
    console.error(params.errorPrefix, redistributionError)
  }
}

export function isMissingRpcFunctionError(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined,
  functionName: string
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return haystack.includes(functionName.toLowerCase()) && (haystack.includes('not found') || haystack.includes('does not exist'))
}
