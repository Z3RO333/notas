import { describe, expect, it, vi } from 'vitest'
import GraficosPage from './page'

const rpcMock = vi.fn()
const callGestaoBaseRpcMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}))

vi.mock('@/lib/graficos/gestao-base-rpc', () => ({
  callGestaoBaseRpc: (...args: unknown[]) => callGestaoBaseRpcMock(...args),
}))

describe('GraficosPage', () => {
  it('throws the main rpc error instead of silently rendering empty charts', async () => {
    rpcMock.mockReset()
    callGestaoBaseRpcMock.mockReset()

    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'calcular_gestao_top_lojas_por_status') {
        return {
          data: null,
          error: {
            message: 'function public.listar_gestao_ordens_base_filtrada(integer, integer, text) is not unique',
            code: '42725',
          },
        }
      }

      return { data: [], error: null }
    })

    callGestaoBaseRpcMock.mockResolvedValue({ data: [], error: null })

    await expect(
      GraficosPage({
        searchParams: Promise.resolve({ ano: '2026' }),
      })
    ).rejects.toMatchObject({
      code: '42725',
    })
  })
})
