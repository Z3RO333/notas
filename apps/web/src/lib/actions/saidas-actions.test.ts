import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/actions/admin-action-support', () => ({
  getAuthenticatedAdminActionContext: vi.fn(),
}))

describe('criarSaidaOperacional', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna erro quando operacionalCodigo é vazio', async () => {
    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('', '2026-06-16', null, [])
    expect(result).toEqual({ data: null, error: 'Técnico é obrigatório' })
  })

  it('retorna erro quando operacionalCodigo é apenas espaços', async () => {
    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('   ', '2026-06-16', null, [])
    expect(result).toEqual({ data: null, error: 'Técnico é obrigatório' })
  })

  it('retorna erro quando dataSaida é inválida', async () => {
    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('OP001', 'not-a-date', null, [])
    expect(result).toEqual({ data: null, error: 'Data de saída inválida' })
  })

  it('retorna erro quando autenticação falha (getAuthenticatedAdminActionContext lança)', async () => {
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockRejectedValueOnce(new Error('Não autorizado'))

    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('OP001', '2026-06-16', null, [])
    expect(result).toEqual({ data: null, error: 'Não autorizado' })
  })

  it('retorna erro quando getAuthenticatedAdminActionContext lança Administrador nao encontrado', async () => {
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockRejectedValueOnce(
      new Error('Administrador nao encontrado'),
    )

    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('OP001', '2026-06-16', null, [])
    expect(result).toEqual({ data: null, error: 'Administrador nao encontrado' })
  })

  it('retorna { id } no sucesso', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: 'saida-uuid-123', error: null })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValueOnce({
      supabase: { rpc: mockRpc } as never,
      admin: { id: 'admin-id-1' } as never,
    })

    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('OP001', '2026-06-16', 'obs teste', [])
    expect(result).toEqual({ data: { id: 'saida-uuid-123' }, error: null })
  })

  it('passa os parâmetros nomeados corretos para o RPC incluindo p_observacao', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: 'saida-uuid-456', error: null })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValueOnce({
      supabase: { rpc: mockRpc } as never,
      admin: { id: 'admin-abc' } as never,
    })

    const ordens = [
      {
        ordem_codigo: 'ORD001',
        numero_nota: '12345',
        unidade: 'UN01',
        texto_breve: 'Manutenção',
        status_ordem_raw_snapshot: 'EM_PROCESSAMENTO',
        tipo_ordem: 'PM01',
      },
    ]

    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    await criarSaidaOperacional('OP001', '2026-06-16', 'observação', ordens)

    expect(mockRpc).toHaveBeenCalledWith('criar_saida_operacional', {
      p_operacional_codigo: 'OP001',
      p_data_saida: '2026-06-16',
      p_admin_id: 'admin-abc',
      p_ordens: ordens,
      p_observacao: 'observação',
    })
  })

  it('repassa erro do RPC', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC falhou' } })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValueOnce({
      supabase: { rpc: mockRpc } as never,
      admin: { id: 'admin-id-1' } as never,
    })

    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('OP001', '2026-06-16', null, [])
    expect(result).toEqual({ data: null, error: 'RPC falhou' })
  })
})

describe('cancelarSaidaOperacional', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna erro quando saidaId é vazio', async () => {
    const { cancelarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await cancelarSaidaOperacional('')
    expect(result).toEqual({ error: 'ID da saída é obrigatório' })
  })

  it('retorna erro quando saidaId é apenas espaços', async () => {
    const { cancelarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await cancelarSaidaOperacional('   ')
    expect(result).toEqual({ error: 'ID da saída é obrigatório' })
  })

  it('retorna erro quando autenticação falha', async () => {
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockRejectedValueOnce(new Error('Sessão expirada'))

    const { cancelarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await cancelarSaidaOperacional('saida-123')
    expect(result).toEqual({ error: 'Sessão expirada' })
  })

  it('retorna { error: null } no sucesso', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ error: null })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValueOnce({
      supabase: { rpc: mockRpc } as never,
      admin: { id: 'admin-id-1' } as never,
    })

    const { cancelarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await cancelarSaidaOperacional('saida-123')
    expect(result).toEqual({ error: null })
  })

  it('repassa erro do RPC', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ error: { message: 'Saída não pode ser cancelada' } })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValueOnce({
      supabase: { rpc: mockRpc } as never,
      admin: { id: 'admin-id-1' } as never,
    })

    const { cancelarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await cancelarSaidaOperacional('saida-123')
    expect(result).toEqual({ error: 'Saída não pode ser cancelada' })
  })
})

describe('registrarResultadoOrdem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function buildSupabaseMock({
    user = { email: 'tecnico@empresa.com' },
    adminData = { id: 'admin-1', role: 'operacional', operacional_codigo: 'OP001' },
    ordemData = {
      saida_id: 'saida-uuid-1',
      operacional_saidas: { operacional_codigo: 'OP001' },
    },
    rpcError = null as { message: string } | null,
  } = {}) {
    const rpc = vi.fn().mockResolvedValue({ error: rpcError })

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'administradores') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: adminData }),
        }
      }
      if (table === 'operacional_saida_ordens') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: ordemData }),
        }
      }
      return {}
    })

    return {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from,
      rpc,
    }
  }

  it('retorna erro quando usuário não está autenticado (user é null)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({ user: null as never }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Não autenticado' })
  })

  it('retorna erro quando email do usuário está ausente', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({ user: { email: '' } as never }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Não autenticado' })
  })

  it('retorna erro quando adminData não é encontrado', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({ adminData: null as never }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Usuário não encontrado' })
  })

  it('retorna erro quando role não é operacional (viewer)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'viewer', operacional_codigo: 'OP001' },
      }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Apenas técnicos operacionais podem registrar resultados' })
  })

  it('retorna erro quando role é admin (não operacional)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'admin', operacional_codigo: 'OP001' },
      }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Apenas técnicos operacionais podem registrar resultados' })
  })

  it('retorna erro quando operacional_codigo é null', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'operacional', operacional_codigo: null as never },
      }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Usuário não vinculado a operacional' })
  })

  it('retorna erro quando ordemData não é encontrado', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({ ordemData: null as never }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Ordem não encontrada' })
  })

  it('retorna erro quando saída pertence a outro técnico', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'operacional', operacional_codigo: 'OP001' },
        ordemData: {
          saida_id: 'saida-uuid-1',
          operacional_saidas: { operacional_codigo: 'OP999' }, // diferente
        },
      }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Acesso negado: saída não pertence a este técnico' })
  })

  it('retorna { error: null } no sucesso', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(buildSupabaseMock() as never)

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', 'tudo ok')
    expect(result).toEqual({ error: null })
  })

  it('repassa erro do RPC', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({ rpcError: { message: 'Resultado já registrado' } }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'nao_resolvida', null)
    expect(result).toEqual({ error: 'Resultado já registrado' })
  })

  it('retorna erro quando role é gestor (não operacional)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValueOnce(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'gestor', operacional_codigo: 'OP001' },
      }) as never,
    )

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'reagendada', null)
    expect(result).toEqual({ error: 'Apenas técnicos operacionais podem registrar resultados' })
  })
})
