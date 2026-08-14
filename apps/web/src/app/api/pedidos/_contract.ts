import type {
  PedidoCompraStatus,
  PedidoCompraStatusEfetivo,
  PedidosContractMeta,
  PedidosKpis,
} from '@/lib/types/pedidos'

type JsonRecord = Record<string, unknown>

const LEGACY_STATUS: readonly PedidoCompraStatus[] = ['em_aberto', 'encerrado', 'cancelado']
const EFFECTIVE_STATUS: readonly PedidoCompraStatusEfetivo[] = [
  ...LEGACY_STATUS,
  'indeterminado',
]

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function normalizePedidoStatus(value: unknown): PedidoCompraStatus | null {
  return LEGACY_STATUS.includes(value as PedidoCompraStatus)
    ? value as PedidoCompraStatus
    : null
}

export function normalizePedidoStatusEfetivo(value: unknown): PedidoCompraStatusEfetivo {
  return EFFECTIVE_STATUS.includes(value as PedidoCompraStatusEfetivo)
    ? value as PedidoCompraStatusEfetivo
    : 'indeterminado'
}

export function mapPedidosKpis(value: unknown): PedidosKpis {
  const row = asRecord(value)
  return {
    total: finiteNumber(row.total),
    em_aberto: finiteNumber(row.em_aberto),
    encerrado: finiteNumber(row.encerrado),
    cancelado: finiteNumber(row.cancelado),
    valor_total: finiteNumber(row.valor_total),
    indeterminado: finiteNumber(row.status_indeterminado ?? row.indeterminado),
    status_indeterminado: finiteNumber(row.status_indeterminado ?? row.indeterminado),
    valor_em_aberto: finiteNumber(row.valor_em_aberto),
    valor_itens_ativos: finiteNumber(row.valor_itens_ativos),
    fornecedores_em_aberto: finiteNumber(row.fornecedores_em_aberto),
    abertos_mais_30_dias: finiteNumber(row.abertos_mais_30_dias),
    abertos_mais_90_dias: finiteNumber(row.abertos_mais_90_dias),
    sem_responsavel: finiteNumber(row.sem_responsavel),
    legado_nao_validado: finiteNumber(row.legado_nao_validado),
    ultima_atualizacao: nullableString(row.ultima_atualizacao),
  }
}

export function buildPedidosContractMeta(value: unknown): PedidosContractMeta {
  const row = asRecord(value)
  const freshness = asRecord(row.freshness)
  const quality = asRecord(row.quality)
  const ultimaAtualizacao = nullableString(
    freshness.asOf
      ?? freshness.as_of
      ?? row.ultima_atualizacao
      ?? row.source_last_seen_at,
  )

  return {
    scope: {
      grupoCompradores: '112',
      periodField: 'data_documento',
      attributionMode: 'responsavel_atual',
    },
    freshness: {
      asOf: ultimaAtualizacao,
      syncedAt: nullableString(freshness.syncedAt ?? freshness.synced_at ?? row.synced_at),
      stale: nullableBoolean(freshness.stale ?? row.stale),
    },
    quality: {
      indeterminados: finiteNumber(
        quality.indeterminados
          ?? quality.status_indeterminado
          ?? row.status_indeterminado
          ?? row.indeterminado,
      ),
      semItens: finiteNumber(quality.semItens ?? quality.sem_itens ?? row.sem_itens),
      semCriadorMapeado: finiteNumber(
        quality.semCriadorMapeado
          ?? quality.sem_criador_mapeado
          ?? row.sem_criador_mapeado,
      ),
      semResponsavel: finiteNumber(quality.semResponsavel ?? quality.sem_responsavel ?? row.sem_responsavel),
      statusDesconhecido: finiteNumber(
        quality.statusDesconhecido
          ?? quality.status_desconhecido
          ?? row.status_desconhecido
          ?? row.legado_nao_validado,
      ),
      legadoNaoValidado: finiteNumber(
        quality.legadoNaoValidado
          ?? quality.legado_nao_validado
          ?? row.legado_nao_validado,
      ),
    },
  }
}
