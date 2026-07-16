import { describe, expect, it, vi } from 'vitest'
import RadarPreventivoPage from './page'

const rpcMock = vi.fn()
const callGestaoBaseRpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    rpc: rpcMock,
  })),
}))

vi.mock('@/lib/graficos/gestao-base-rpc', () => ({
  callGestaoBaseRpc: (...args: unknown[]) => callGestaoBaseRpcMock(...args),
}))

describe('RadarPreventivoPage', () => {
  it('loads the preventive analysis from its own route', async () => {
    rpcMock.mockReset()
    callGestaoBaseRpcMock.mockReset()

    rpcMock.mockResolvedValue({
      data: [{ tipo_ordem: 'PMOS', ano: 2026 }],
      error: null,
    })

    callGestaoBaseRpcMock.mockResolvedValue({
      data: [{
        ordem_id: '1',
        ordem_codigo: '101',
        tipo_ordem: 'PMOS',
        competencia_data: '2026-03-01',
        ano: 2026,
        mes: 3,
        nome_loja: 'LOJA A',
        tipo_unidade: 'LOJA',
        texto_breve: 'PINTURA',
        status_ordem_raw: 'ABERTO',
        nota_referencia: '1',
      }],
      error: null,
    })

    const page = await RadarPreventivoPage({
      searchParams: Promise.resolve({
        preventiva_periodo: 'ano',
        preventiva_ano: '2026',
        tipo_ordem: 'PMOS',
      }),
    })

    expect(page).toBeTruthy()
    expect(rpcMock).toHaveBeenCalledWith('listar_gestao_filtros')
    expect(callGestaoBaseRpcMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        p_ano: 2026,
        p_mes: null,
        p_tipo_ordem: 'PMOS',
      }),
    )
  })

  it('defaults the radar to PMOS when tipo_ordem is missing', async () => {
    rpcMock.mockReset()
    callGestaoBaseRpcMock.mockReset()

    rpcMock.mockResolvedValue({
      data: [{ tipo_ordem: 'PMOS', ano: 2026 }],
      error: null,
    })

    callGestaoBaseRpcMock.mockResolvedValue({
      data: [{
        ordem_id: '1',
        ordem_codigo: '101',
        tipo_ordem: 'PMOS',
        competencia_data: '2026-03-01',
        ano: 2026,
        mes: 3,
        nome_loja: 'LOJA A',
        tipo_unidade: 'LOJA',
        texto_breve: 'PINTURA',
        status_ordem_raw: 'ABERTO',
        nota_referencia: '1',
      }],
      error: null,
    })

    const page = await RadarPreventivoPage({
      searchParams: Promise.resolve({
        preventiva_periodo: 'ano',
        preventiva_ano: '2026',
      }),
    })

    expect(page).toBeTruthy()
    expect(callGestaoBaseRpcMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        p_ano: 2026,
        p_mes: null,
        p_tipo_ordem: 'PMOS',
      }),
    )
  })
})
