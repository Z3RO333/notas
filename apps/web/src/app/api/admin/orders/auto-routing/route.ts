import { NextResponse } from 'next/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { applyAutomaticOrdersRouting } from '@/lib/orders/pmpl-routing'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const currentAdminContext = await getCurrentAdminContext()

  if (!currentAdminContext.isGestor || !currentAdminContext.adminId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  try {
    const supabase = createAdminClient()
    await applyAutomaticOrdersRouting({
      supabase,
      gestorId: currentAdminContext.adminId,
      debug: process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1',
      motivo: 'Auto realocacao PMPL/Refrigeracao/CD (Painel Administrativo)',
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao aplicar auto-routing'
    console.error('[admin/auto-routing] failed:', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
