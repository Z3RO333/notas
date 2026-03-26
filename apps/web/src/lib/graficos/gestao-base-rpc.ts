import type { GestaoBaseOrdem, TipoUnidade } from '@/lib/types/database'

type RpcErrorLike = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

type RpcResult<T> = {
  data: T | null
  error: RpcErrorLike | null
}

type RpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => PromiseLike<RpcResult<unknown>>
}

export interface GestaoBaseRpcParams {
  p_ano: number | null
  p_mes: number | null
  p_tipo_ordem: string | null
  p_texto_breve?: string | null
  p_tipo_unidade?: TipoUnidade | null
  p_limit?: number | null
  p_nome_loja?: string | null
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function clampLimit(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null
  return Math.max(1, Math.min(500, Math.trunc(value as number)))
}

export function isGestaoBaseRpcPushdownMissing(
  error: RpcErrorLike | null | undefined,
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true

  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return (
    haystack.includes('listar_gestao_ordens_base_filtrada')
    && (
      haystack.includes('not found')
      || haystack.includes('does not exist')
      || haystack.includes('schema cache')
      || haystack.includes('p_texto_breve')
      || haystack.includes('p_tipo_unidade')
      || haystack.includes('p_limit')
    )
  )
}

function sortGestaoBaseRows(rows: GestaoBaseOrdem[]): GestaoBaseOrdem[] {
  return [...rows].sort((left, right) => {
    const leftDate = normalizeText(left.competencia_data)
    const rightDate = normalizeText(right.competencia_data)

    if (leftDate && rightDate && leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate)
    }
    if (leftDate && !rightDate) return -1
    if (!leftDate && rightDate) return 1

    return normalizeText(left.ordem_codigo).localeCompare(normalizeText(right.ordem_codigo), 'pt-BR')
  })
}

function applyLegacyClientFiltering(
  rows: GestaoBaseOrdem[],
  params: GestaoBaseRpcParams,
): GestaoBaseOrdem[] {
  const textoBreve = normalizeText(params.p_texto_breve)
  const tipoUnidade = normalizeText(params.p_tipo_unidade)
  const limit = clampLimit(params.p_limit)

  const filtered = rows.filter((row) => {
    if (textoBreve && normalizeText(row.texto_breve) !== textoBreve) return false
    if (tipoUnidade && normalizeText(row.tipo_unidade).toUpperCase() !== tipoUnidade.toUpperCase()) return false
    return true
  })

  const sorted = sortGestaoBaseRows(filtered)
  return limit ? sorted.slice(0, limit) : sorted
}

export async function callGestaoBaseRpc(
  supabase: RpcClient,
  params: GestaoBaseRpcParams,
): Promise<RpcResult<GestaoBaseOrdem[]>> {
  const pushdownParams = {
    p_ano: params.p_ano,
    p_mes: params.p_mes,
    p_tipo_ordem: params.p_tipo_ordem,
    p_texto_breve: params.p_texto_breve ?? null,
    p_tipo_unidade: params.p_tipo_unidade ?? null,
    p_limit: params.p_limit ?? null,
    p_nome_loja: params.p_nome_loja ?? null,
  }

  const pushdownResult = await supabase.rpc('listar_gestao_ordens_base_filtrada', pushdownParams)
  if (!pushdownResult.error) {
    return {
      data: ((pushdownResult.data ?? []) as GestaoBaseOrdem[]),
      error: null,
    }
  }

  if (!isGestaoBaseRpcPushdownMissing(pushdownResult.error)) {
    return {
      data: null,
      error: pushdownResult.error,
    }
  }

  const legacyResult = await supabase.rpc('listar_gestao_ordens_base_filtrada', {
    p_ano: params.p_ano,
    p_mes: params.p_mes,
    p_tipo_ordem: params.p_tipo_ordem,
  })

  if (legacyResult.error) {
    return {
      data: null,
      error: legacyResult.error,
    }
  }

  const legacyRows = ((legacyResult.data ?? []) as GestaoBaseOrdem[])
  return {
    data: applyLegacyClientFiltering(legacyRows, params),
    error: null,
  }
}
