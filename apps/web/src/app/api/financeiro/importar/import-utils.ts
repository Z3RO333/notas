import type {
  FinanceiroImportError,
  FinanceiroImportRow,
  FinanceiroImportScope,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'

const VALID_TIPOS = new Set<FinanceiroTipoOrdem>(['PMOS', 'PMPL'])

export type FinanceiroPayload = {
  ordem_codigo: string
  tipo_ordem: FinanceiroTipoOrdem
  numero_nota: string | null
  data_entrada: string | null
  inicio_programado: string | null
  denominacao_unidade: string | null
  texto_breve: string | null
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  custos_estimados: number
  custos_totais_materiais: number
  custos_adicionais: number
  custos_totais_reais: number
  source_file_name: string | null
  imported_by: string
  importado_em: string
  updated_at: string
  raw_payload: Record<string, unknown>
}

export function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeTipoOrdem(value: unknown): FinanceiroTipoOrdem | null {
  const trimmed = normalizeOptionalText(value)?.toUpperCase()
  if (!trimmed) return null
  return VALID_TIPOS.has(trimmed as FinanceiroTipoOrdem) ? trimmed as FinanceiroTipoOrdem : null
}

export function normalizeMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2))
  }

  const text = normalizeOptionalText(value)
  if (!text) return 0

  const compact = text.replace(/\s+/g, '')
  const brPattern = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/
  const usPattern = /^-?\d{1,3}(,\d{3})*(\.\d+)?$/

  let normalized = compact
  if (brPattern.test(compact)) {
    normalized = compact.replace(/\./g, '').replace(',', '.')
  } else if (usPattern.test(compact)) {
    normalized = compact.replace(/,/g, '')
  } else if (/^-?\d+,\d+$/.test(compact)) {
    normalized = compact.replace(',', '.')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

export function parseDateOnly(value: unknown): string | null {
  const text = normalizeOptionalText(value)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})T?/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

export function resolveValorPrevistoPendente(
  custosTotaisReais: number,
  custosEstimados: number,
  custosTotaisMateriais: number,
): number {
  const valorReal = Math.max(custosTotaisReais || 0, 0)
  if (valorReal > 0) return 0

  return Math.max(
    Math.max(custosEstimados || 0, 0),
    Math.max(custosTotaisMateriais || 0, 0),
  )
}

export function getCompetenciaDate(
  tipoOrdem: FinanceiroTipoOrdem,
  dataEntrada: string | null,
  inicioProgramado: string | null,
): string | null {
  if (tipoOrdem === 'PMPL') return inicioProgramado ?? dataEntrada
  return dataEntrada
}

export function buildScopeKey(scope: FinanceiroImportScope): string {
  return `${scope.tipo_ordem}:${scope.competencia_inicio}:${scope.competencia_fim}`
}

export function buildReplacementScopes(payloads: FinanceiroPayload[]): FinanceiroImportScope[] {
  const byType = new Map<FinanceiroTipoOrdem, { min: string; max: string }>()

  for (const payload of payloads) {
    const competencia = getCompetenciaDate(
      payload.tipo_ordem,
      payload.data_entrada,
      payload.inicio_programado,
    )
    if (!competencia) continue

    const current = byType.get(payload.tipo_ordem)
    if (!current) {
      byType.set(payload.tipo_ordem, { min: competencia, max: competencia })
      continue
    }

    if (competencia < current.min) current.min = competencia
    if (competencia > current.max) current.max = competencia
  }

  return Array.from(byType.entries())
    .map(([tipo_ordem, range]) => ({
      tipo_ordem,
      competencia_inicio: range.min,
      competencia_fim: range.max,
    }))
    .sort((left, right) => left.tipo_ordem.localeCompare(right.tipo_ordem))
}

export function normalizeFinanceiroRow(
  row: FinanceiroImportRow,
  sourceFileName: string | null,
  adminId: string,
  now: string,
): { payload: FinanceiroPayload | null; error: FinanceiroImportError | null } {
  const ordemCodigo = normalizeOptionalText(row.ordem_codigo)
  if (!ordemCodigo) {
    return {
      payload: null,
      error: { linha: row.rowIndex, ordem_codigo: '', motivo: 'Codigo da ordem obrigatorio' },
    }
  }

  const tipoOrdem = normalizeTipoOrdem(row.tipo_ordem)
  if (!tipoOrdem) {
    return {
      payload: null,
      error: { linha: row.rowIndex, ordem_codigo: ordemCodigo, motivo: 'Tipo de ordem invalido (use PMOS ou PMPL)' },
    }
  }

  const dataEntrada = parseDateOnly(row.data_entrada)
  const inicioProgramado = parseDateOnly(row.inicio_programado)
  const competenciaDate = getCompetenciaDate(tipoOrdem, dataEntrada, inicioProgramado)

  if (!competenciaDate) {
    return {
      payload: null,
      error: {
        linha: row.rowIndex,
        ordem_codigo: ordemCodigo,
        motivo: tipoOrdem === 'PMPL'
          ? 'PMPL precisa de inicio programado ou data de entrada'
          : 'Data de entrada invalida ou ausente',
      },
    }
  }

  return {
    error: null,
    payload: {
      ordem_codigo: ordemCodigo,
      tipo_ordem: tipoOrdem,
      numero_nota: normalizeOptionalText(row.numero_nota),
      data_entrada: dataEntrada,
      inicio_programado: inicioProgramado,
      denominacao_unidade: normalizeOptionalText(row.denominacao_unidade),
      texto_breve: normalizeOptionalText(row.texto_breve),
      fornecedor_codigo: normalizeOptionalText(row.fornecedor_codigo),
      fornecedor_nome: normalizeOptionalText(row.fornecedor_nome),
      custos_estimados: normalizeMoney(row.custos_estimados),
      custos_totais_materiais: normalizeMoney(row.custos_totais_materiais),
      custos_adicionais: normalizeMoney(row.custos_adicionais),
      custos_totais_reais: normalizeMoney(row.custos_totais_reais),
      source_file_name: sourceFileName,
      imported_by: adminId,
      importado_em: now,
      updated_at: now,
      raw_payload: row as unknown as Record<string, unknown>,
    },
  }
}
