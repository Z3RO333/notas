import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getCurrentRequestAdminContext: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/auth/request-admin-context', () => ({
  getCurrentRequestAdminContext: mocks.getCurrentRequestAdminContext,
}))

import { GET } from './route'

const ADMIN_ID = '22222222-2222-4222-8222-222222222222'

function buildSupabaseMock() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
}

describe('GET /api/ordens/fornecedor-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentRequestAdminContext.mockResolvedValue({
      email: 'gestor@bemol.com.br',
      adminId: ADMIN_ID,
      actualRole: 'gestor',
    })
  })

  it('usa a RPC exclusiva de service_role com o admin validado', async () => {
    const supabase = buildSupabaseMock()
    mocks.createAdminClient.mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/ordens/fornecedor-search?q=weg&limit=25'))

    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith('buscar_ordens_fornecedor_global_service', {
      p_q: 'weg',
      p_admin_id: ADMIN_ID,
      p_limit: 25,
    })
  })

  it('bloqueia role sem permissão antes da RPC', async () => {
    const supabase = buildSupabaseMock()
    mocks.createAdminClient.mockReturnValue(supabase)
    mocks.getCurrentRequestAdminContext.mockResolvedValue({
      email: 'viewer@bemol.com.br',
      adminId: ADMIN_ID,
      actualRole: 'viewer',
    })

    const response = await GET(new Request('http://localhost/api/ordens/fornecedor-search?q=weg'))

    expect(response.status).toBe(403)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('valida o tamanho da busca antes da RPC', async () => {
    const supabase = buildSupabaseMock()
    mocks.createAdminClient.mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/ordens/fornecedor-search?q=ab'))

    expect(response.status).toBe(400)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
