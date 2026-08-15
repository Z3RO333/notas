import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: vi.fn(),
}))

vi.mock('@/lib/actions/admin-action-support', () => ({
  getAuthenticatedAdminActionContext: vi.fn(),
}))

const ordemInput = [{
  ordem_codigo: 'ORD001',
  numero_nota: '12345',
  unidade: 'UN01',
  texto_breve: 'Manutenção',
  status_ordem_raw_snapshot: 'EM_PROCESSAMENTO',
  tipo_ordem: 'PM01',
}]

describe('criarSaidaOperacional', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
    const result = await criarSaidaOperacional('OP001', '2026-06-16', null, ordemInput)
    expect(result).toEqual({ data: null, error: 'Não autorizado' })
  })

  it('retorna erro quando getAuthenticatedAdminActionContext lança Administrador nao encontrado', async () => {
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    vi.mocked(getAuthenticatedAdminActionContext).mockRejectedValueOnce(
      new Error('Administrador nao encontrado'),
    )

    const { criarSaidaOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await criarSaidaOperacional('OP001', '2026-06-16', null, ordemInput)
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
    const result = await criarSaidaOperacional('OP001', '2026-06-16', 'obs teste', ordemInput)
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
    const result = await criarSaidaOperacional('OP001', '2026-06-16', null, ordemInput)
    expect(result).toEqual({ data: null, error: 'RPC falhou' })
  })
})

describe('cancelarSaidaOperacional', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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

describe('redistribuirOrdemOperacional', () => {
  const command = {
    command_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: '22222222-2222-4222-8222-222222222222',
    status: 'pending',
    source_cockpit_cargo_id: '33333333-3333-4333-8333-333333333333',
    target_cockpit_cargo_id: '44444444-4444-4444-8444-444444444444',
    source_operational_code: '14606',
    target_operational_code: '10262',
    target_rota_operational_id: '55555555-5555-4555-8555-555555555555',
    order_number: '40001234',
    reason: 'Redistribuição de agenda',
    planned_date: '2026-08-15',
    attempt_count: 0,
    next_retry_at: null,
    rota_transfer_id: null,
    sap_sync_status: 'not_requested',
  }

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ROTA_API_URL = 'https://rota.example.com/api'
    process.env.ROTA_INTEGRATION_SECRET = 'test-integration-secret'
  })

  function buildContext({
    rotaFails = false,
    requestError = null as string | null,
  } = {}) {
    const rpc = vi.fn()
    if (requestError) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: requestError } })
      return { supabase: { rpc }, rpc }
    }

    rpc
      .mockResolvedValueOnce({ data: command, error: null })
      .mockResolvedValueOnce({ data: { ...command, status: 'processing', attempt_count: 1 }, error: null })

    if (rotaFails) {
      rpc.mockResolvedValueOnce({ data: { ...command, status: 'failed' }, error: null })
    } else {
      rpc.mockResolvedValueOnce({ data: { ...command, status: 'completed' }, error: null })
    }

    return { supabase: { rpc }, rpc }
  }

  it('move a mesma ordem no ROTA e confirma o comando no Cockpit', async () => {
    const context = buildContext()
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValue({
      supabase: context.supabase as never,
      admin: { id: '66666666-6666-4666-8666-666666666666', role: 'gestor' },
    })
    vi.mocked(getSessionEmail).mockResolvedValue('gestor@example.com')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({
        reassignment_id: '77777777-7777-4777-8777-777777777777',
        route_order_id: '88888888-8888-4888-8888-888888888888',
        order_number: command.order_number,
        source_route_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        target_route_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        source_stop_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        target_stop_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        source_operational_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        target_operational_id: command.target_rota_operational_id,
        source_dispatch_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        target_dispatch_id: 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb',
        idempotency_key: command.idempotency_key,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { redistribuirOrdemOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await redistribuirOrdemOperacional({
      saidaOrdemId: '99999999-9999-4999-8999-999999999999',
      novoOperacionalCodigo: '10262',
      motivo: 'Redistribuição de agenda',
    })

    expect(result).toEqual({
      data: { commandId: command.command_id, targetSaidaId: command.target_cockpit_cargo_id },
      error: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rota.example.com/api/integration/reassign-order',
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(request.body as string)).toEqual(expect.objectContaining({
      idempotency_key: command.idempotency_key,
      order_number: command.order_number,
      source_cockpit_cargo_id: command.source_cockpit_cargo_id,
      target_cockpit_cargo_id: command.target_cockpit_cargo_id,
      target_operational_id: command.target_rota_operational_id,
      performed_by_email: 'gestor@example.com',
    }))
    expect(context.rpc).toHaveBeenLastCalledWith('confirmar_redistribuicao_ordem', {
      p_redistribuicao_id: command.command_id,
      p_admin_id: '66666666-6666-4666-8666-666666666666',
      p_rota_transfer_id: '77777777-7777-4777-8777-777777777777',
    })
  })

  it('bloqueia destino sem conta operacional ativa no ROTA', async () => {
    const context = buildContext({
      requestError: 'O novo operacional ainda não possui acesso ativo vinculado ao ROTA',
    })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValue({
      supabase: context.supabase as never,
      admin: { id: '66666666-6666-4666-8666-666666666666', role: 'gestor' },
    })
    vi.mocked(getSessionEmail).mockResolvedValue('gestor@example.com')

    const { redistribuirOrdemOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await redistribuirOrdemOperacional({
      saidaOrdemId: '99999999-9999-4999-8999-999999999999',
      novoOperacionalCodigo: '10262',
      motivo: 'Redistribuição de agenda',
    })

    expect(result).toEqual({
      data: null,
      error: 'O novo operacional ainda não possui acesso ativo vinculado ao ROTA',
    })
    expect(context.rpc).toHaveBeenCalledTimes(1)
  })

  it('registra falha reconciliável quando o ROTA rejeita a movimentação', async () => {
    const context = buildContext({ rotaFails: true })
    const { getAuthenticatedAdminActionContext } = await import('@/lib/actions/admin-action-support')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(getAuthenticatedAdminActionContext).mockResolvedValue({
      supabase: context.supabase as never,
      admin: { id: '66666666-6666-4666-8666-666666666666', role: 'gestor' },
    })
    vi.mocked(getSessionEmail).mockResolvedValue('gestor@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({ error: 'Ordem já concluída no ROTA' }),
    }))

    const { redistribuirOrdemOperacional } = await import('@/lib/actions/saidas-actions')
    const result = await redistribuirOrdemOperacional({
      saidaOrdemId: '99999999-9999-4999-8999-999999999999',
      novoOperacionalCodigo: '10262',
      motivo: 'Redistribuição de agenda',
    })

    expect(result).toEqual({ data: null, error: 'Ordem já concluída no ROTA' })
    expect(context.rpc).toHaveBeenLastCalledWith('registrar_falha_redistribuicao_ordem', {
      p_redistribuicao_id: command.command_id,
      p_admin_id: '66666666-6666-4666-8666-666666666666',
      p_erro: 'Ordem já concluída no ROTA',
    })
  })
})

describe('registrarResultadoOrdem', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  function buildSupabaseMock({
    adminData = { id: 'admin-1', role: 'operacional', operacional_codigo: 'OP001' },
    ordemData = {
      saida_id: 'saida-uuid-1',
      operacional_saidas: { operacional_codigo: 'OP001' },
    },
    rpcError = null as { message: string } | null,
  } = {}) {
    const rpc = vi.fn().mockResolvedValue({ error: rpcError })

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'administradores' || table === 'vw_administrador_por_email') {
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

    return { from, rpc }
  }

  it('retorna erro quando não há sessão (getSessionEmail resolve null)', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(buildSupabaseMock() as never)
    vi.mocked(getSessionEmail).mockResolvedValueOnce(null)

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Não autenticado' })
  })

  it('retorna erro quando email da sessão está ausente', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(buildSupabaseMock() as never)
    vi.mocked(getSessionEmail).mockResolvedValueOnce('')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Não autenticado' })
  })

  it('retorna erro quando adminData não é encontrado', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({ adminData: null as never }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Usuário não encontrado' })
  })

  it('retorna erro quando role não é operacional (viewer)', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'viewer', operacional_codigo: 'OP001' },
      }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Apenas técnicos operacionais podem registrar resultados' })
  })

  it('retorna erro quando role é admin (não operacional)', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'admin', operacional_codigo: 'OP001' },
      }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Apenas técnicos operacionais podem registrar resultados' })
  })

  it('retorna erro quando operacional_codigo é null', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'operacional', operacional_codigo: null as never },
      }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Usuário não vinculado a operacional' })
  })

  it('retorna erro quando ordemData não é encontrado', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({ ordemData: null as never }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Ordem não encontrada' })
  })

  it('retorna erro quando saída pertence a outro técnico', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'operacional', operacional_codigo: 'OP001' },
        ordemData: {
          saida_id: 'saida-uuid-1',
          operacional_saidas: { operacional_codigo: 'OP999' }, // diferente
        },
      }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', null)
    expect(result).toEqual({ error: 'Acesso negado: saída não pertence a este técnico' })
  })

  it('retorna { error: null } no sucesso', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(buildSupabaseMock() as never)
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'resolvida', 'tudo ok')
    expect(result).toEqual({ error: null })
  })

  it('repassa erro do RPC', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({ rpcError: { message: 'Resultado já registrado' } }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'nao_resolvida', null)
    expect(result).toEqual({ error: 'Resultado já registrado' })
  })

  it('retorna erro quando role é gestor (não operacional)', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getSessionEmail } = await import('@/lib/auth/session')
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        adminData: { id: 'admin-1', role: 'gestor', operacional_codigo: 'OP001' },
      }) as never,
    )
    vi.mocked(getSessionEmail).mockResolvedValueOnce('tecnico@empresa.com')

    const { registrarResultadoOrdem } = await import('@/lib/actions/saidas-actions')
    const result = await registrarResultadoOrdem('ordem-1', 'reagendada', null)
    expect(result).toEqual({ error: 'Apenas técnicos operacionais podem registrar resultados' })
  })
})
