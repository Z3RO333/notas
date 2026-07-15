import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const timestamp = new Date().toISOString()

  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    // Admin client: o healthcheck roda sem sessão e o role anon não tem mais acesso ao schema public
    const supabase = createAdminClient()
    const { error } = await supabase.from('administradores').select('id').limit(1).single()
    if (error && error.code !== 'PGRST116') dbStatus = 'error'
  } catch {
    dbStatus = 'error'
  }

  const status = dbStatus === 'ok' ? 'ok' : 'degraded'
  const httpStatus = status === 'ok' ? 200 : 503

  return NextResponse.json(
    { status, timestamp, checks: { database: dbStatus } },
    { status: httpStatus },
  )
}
