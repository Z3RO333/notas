import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getSessionEmail: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: mocks.getSessionEmail,
}))

import { POST } from './route'

const NOTA_ID = '11111111-1111-4111-8111-111111111111'
const ADMIN_ID = '22222222-2222-4222-8222-222222222222'

function request(body: unknown): Request {
  return new Request('http://localhost/api/notas/copy-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildSupabaseMock(admin: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: admin, error: null }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)

  return {
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn().mockResolvedValue({
      data: {
        ok: true,
        code: 'marked',
        nota_id: NOTA_ID,
        numero_nota: '10177662',
        status_operacional: 'EM_GERACAO',
      },
      error: null,
    }),
  }
}

describe('POST /api/notas/copy-intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionEmail.mockResolvedValue('gestor@bemol.com.br')
  })

  it('passa o admin validado para a RPC exclusiva de service_role', async () => {
    const supabase = buildSupabaseMock({ id: ADMIN_ID, role: 'gestor', ativo: true })
    mocks.createAdminClient.mockReturnValue(supabase)

    const response = await POST(request({ notaId: NOTA_ID, forceOverride: true }))

    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith('marcar_nota_em_geracao_service', {
      p_nota_id: NOTA_ID,
      p_actor_id: ADMIN_ID,
      p_force_override: true,
      p_trigger: 'copy_button',
    })
  })

  it('bloqueia administrador inativo antes da RPC', async () => {
    const supabase = buildSupabaseMock({ id: ADMIN_ID, role: 'gestor', ativo: false })
    mocks.createAdminClient.mockReturnValue(supabase)

    const response = await POST(request({ notaId: NOTA_ID }))

    expect(response.status).toBe(403)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('exige sessão NextAuth', async () => {
    const supabase = buildSupabaseMock(null)
    mocks.createAdminClient.mockReturnValue(supabase)
    mocks.getSessionEmail.mockResolvedValue(null)

    const response = await POST(request({ notaId: NOTA_ID }))

    expect(response.status).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
