import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const timestamp = new Date().toISOString()

  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    const supabase = await createClient()
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
