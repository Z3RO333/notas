import { describe, expect, it, vi } from 'vitest'
import { buildGestaoLojasDisponiveis } from './gestao-filter-options'
import GraficosPage from './page'

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

vi.mock('@/lib/auth/current-admin-context', () => ({
  getCurrentAdminContext: vi.fn(async () => ({
    adminId: 'test-admin-id',
    isGestor: true,
    nome: 'Test Admin',
  })),
}))

describe('GraficosPage', () => {
  it('dedupes loja options ignoring case and accents while keeping the readable label', () => {
    expect(
      buildGestaoLojasDisponiveis([
        { nome_loja: 'FARMA CAREIRO', tipo_unidade: 'FARMA' },
        { nome_loja: 'Farma Careiro', tipo_unidade: 'FARMA' },
        { nome_loja: 'Loja Maues', tipo_unidade: 'LOJA' },
        { nome_loja: 'Loja Maués', tipo_unidade: 'LOJA' },
        { nome_loja: 'Contabilidade', tipo_unidade: 'ESCRITORIO' },
      ]),
    ).toEqual(['Farma Careiro', 'Loja Maués'])
  })

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
