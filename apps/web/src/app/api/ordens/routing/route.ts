import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyAutomaticOrdersRouting } from '@/lib/orders/pmpl-routing'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }

  const supabase = await createClient()

  const { data: gestor, error: gestorError } = await supabase
    .from('administradores')
    .select('id')
    .eq('role', 'gestor')
    .eq('ativo', true)
    .order('nome')
    .limit(1)
    .single()

  if (gestorError || !gestor) {
    return NextResponse.json({ error: 'Nenhum gestor ativo encontrado' }, { status: 500 })
  }

  const debug = process.env.DEBUG_ORDERS_ROUTING === '1'

  try {
    const result = await applyAutomaticOrdersRouting({
      supabase,
      gestorId: gestor.id,
      debug,
      motivo: 'Auto realocacao PMPL/Refrigeracao/CD (cron)',
    })

    console.log('[cron/routing] concluido', {
      movedCount: result.movedCount,
      pendingCount: result.pendingCount,
      conflictCount: result.conflictCount,
      detectedPmpl: result.detectedPmpl,
    })

    return NextResponse.json({
      movedCount: result.movedCount,
      pendingCount: result.pendingCount,
      conflictCount: result.conflictCount,
      detectedPmpl: result.detectedPmpl,
      detectedByUnit: result.detectedByUnit,
    })
  } catch (error) {
    console.error('[cron/routing] falha:', error)
    return NextResponse.json({ error: 'Falha ao aplicar roteamento' }, { status: 500 })
  }
}
