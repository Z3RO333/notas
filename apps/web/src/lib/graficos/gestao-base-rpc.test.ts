import { describe, expect, it, vi } from 'vitest'
import { callGestaoBaseRpc, isGestaoBaseRpcPushdownMissing } from './gestao-base-rpc'

describe('gestao-base-rpc', () => {
  it('accepts the pushdown signature when available', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ordem_id: '1', ordem_codigo: '5222', competencia_data: '2026-03-10' }],
      error: null,
    })

    const result = await callGestaoBaseRpc(
      { rpc },
      {
        p_ano: 2026,
        p_mes: 3,
        p_tipo_ordem: 'PMOS',
      },
    )

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('listar_gestao_ordens_base_filtrada', {
      p_ano: 2026,
      p_mes: 3,
      p_tipo_ordem: 'PMOS',
      p_texto_breve: null,
      p_tipo_unidade: null,
      p_limit: null,
    })
  })

  it('falls back to the legacy signature and filters locally', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.listar_gestao_ordens_base_filtrada(...) in the schema cache',
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            ordem_id: '1',
            ordem_codigo: '5223',
            competencia_data: '2026-03-09',
            texto_breve: 'PINTURA',
            tipo_unidade: 'LOJA',
          },
          {
            ordem_id: '2',
            ordem_codigo: '5221',
            competencia_data: '2026-03-11',
            texto_breve: 'ELETRICA',
            tipo_unidade: 'LOJA',
          },
          {
            ordem_id: '3',
            ordem_codigo: '5222',
            competencia_data: '2026-03-10',
            texto_breve: 'PINTURA',
            tipo_unidade: 'LOJA',
          },
          {
            ordem_id: '4',
            ordem_codigo: '5224',
            competencia_data: '2026-03-12',
            texto_breve: 'PINTURA',
            tipo_unidade: 'CD',
          },
        ],
        error: null,
      })

    const result = await callGestaoBaseRpc(
      { rpc },
      {
        p_ano: 2026,
        p_mes: 3,
        p_tipo_ordem: 'PMOS',
        p_texto_breve: 'PINTURA',
        p_tipo_unidade: 'LOJA',
        p_limit: 1,
      },
    )

    expect(result.error).toBeNull()
    expect(result.data).toEqual([
      expect.objectContaining({
        ordem_id: '3',
        texto_breve: 'PINTURA',
        tipo_unidade: 'LOJA',
      }),
    ])
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(2, 'listar_gestao_ordens_base_filtrada', {
      p_ano: 2026,
      p_mes: 3,
      p_tipo_ordem: 'PMOS',
    })
  })

  it('recognizes missing pushdown signatures', () => {
    expect(isGestaoBaseRpcPushdownMissing({ code: 'PGRST202' })).toBe(true)
    expect(isGestaoBaseRpcPushdownMissing({ message: 'function listar_gestao_ordens_base_filtrada(p_texto_breve => text) does not exist' })).toBe(true)
    expect(isGestaoBaseRpcPushdownMissing({ message: 'other failure' })).toBe(false)
    expect(isGestaoBaseRpcPushdownMissing(null)).toBe(false)
  })
})
