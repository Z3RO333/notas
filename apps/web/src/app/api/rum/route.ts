import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface RumMetricPayload {
  name?: unknown
  value?: unknown
  rating?: unknown
  page?: unknown
  id?: unknown
}

export async function POST(request: Request) {
  let payload: RumMetricPayload

  try {
    payload = (await request.json()) as RumMetricPayload
  } catch {
    return NextResponse.json({ error: 'Payload invalido' }, { status: 400 })
  }

  if (typeof payload.name !== 'string' || typeof payload.value !== 'number') {
    return NextResponse.json({ error: 'Payload invalido' }, { status: 400 })
  }

  logger.info('[rum] web-vital', {
    id: typeof payload.id === 'string' ? payload.id : null,
    name: payload.name,
    value: payload.value,
    rating: typeof payload.rating === 'string' ? payload.rating : null,
    page: typeof payload.page === 'string' ? payload.page : null,
    userAgent: request.headers.get('user-agent') ?? null,
  })

  return new NextResponse(null, { status: 204 })
}
