const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const DEFAULT_FROM_YEAR = 2022
const DEFAULT_TO_YEAR = 2025
const INSERT_BATCH_SIZE = 500
const LOOKUP_CHUNK_SIZE = 1000
const RPC_CHUNK_SIZE = 1000
const VALID_TYPES = new Set(['PMOS', 'PMPL'])
const FIELD_ALIASES = {
  ordem_codigo: ['ORDEM'],
  tipo_ordem: ['TIPO_DE_ORDEM', 'TIPO_ORDEM'],
  data_entrada: ['DATA_DE_ENTRADA', 'DATA_ENTRADA'],
  inicio_programado: ['INICIO_PROGRAMADO', 'INICIO_PROG', 'DATA_INICIO_PROGRAMADO'],
  denominacao_unidade: ['DENOMINACAO', 'DENOMINACAO_UNIDADE'],
  texto_breve: ['TEXTO_BREVE'],
  fornecedor_codigo: ['FORNECEDOR'],
  fornecedor_nome: ['NOME_FORNECEDOR_CT'],
  custos_estimados: ['CUSTS_ESTIMADOS'],
  custos_totais_materiais: ['CUSTOS_TOT_MAT', 'CUSTOS_TOTAIS_MAT'],
  custos_adicionais: ['CUSTS_ADICIONAIS'],
  custos_totais_reais: ['CUST_TOT_REAIS', 'CUSTOS_TOTAIS_REAIS'],
}

function normalizeHeaderKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTipoOrdem(value) {
  const normalized = normalizeOptionalText(value)?.toUpperCase() ?? null
  return VALID_TYPES.has(normalized) ? normalized : null
}

function normalizeMoney(value) {
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

function formatDateParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseDateOnly(value) {
  if (value === undefined || value === null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return formatDateParts(parsed.y, parsed.m, parsed.d)
  }

  const text = normalizeOptionalText(value)
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const isoDateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T]/)
  if (isoDateTime) return `${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`

  const brDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brDate) {
    return `${brDate[3]}-${brDate[2].padStart(2, '0')}-${brDate[1].padStart(2, '0')}`
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return formatDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

function autoDetectMapping(headers) {
  const normalizedHeaders = headers.map((header) => normalizeHeaderKey(header))
  const result = {}

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    result[field] = null
    for (const alias of aliases) {
      const index = normalizedHeaders.indexOf(alias)
      if (index !== -1) {
        result[field] = headers[index]
        break
      }
    }
  }

  return result
}

function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function buildSourceTag(filePath, fromYear, toYear) {
  return `${path.basename(filePath)}::historico_${fromYear}_${toYear}`
}

function getCompetenciaDate(tipoOrdem, dataEntrada, inicioProgramado) {
  if (tipoOrdem === 'PMPL') return inicioProgramado || dataEntrada
  if (tipoOrdem === 'PMOS') return dataEntrada
  return null
}

function getYearFromIsoDate(isoDate) {
  return Number(isoDate.slice(0, 4))
}

function isCompetenciaInRange(competenciaDate, fromYear, toYear) {
  if (!competenciaDate) return false
  const year = getYearFromIsoDate(competenciaDate)
  return year >= fromYear && year <= toYear
}

function buildYearTypeKey(year, tipoOrdem) {
  return `${year}-${tipoOrdem}`
}

function incrementCounter(counter, key, value = 1) {
  counter[key] = (counter[key] ?? 0) + value
}

function normalizeRow(rawRow, rowIndex, mapping, sourceTag) {
  const ordemCodigo = normalizeOptionalText(rawRow[mapping.ordem_codigo])
  const tipoOrdem = normalizeTipoOrdem(rawRow[mapping.tipo_ordem])
  const dataEntrada = parseDateOnly(rawRow[mapping.data_entrada])
  const inicioProgramado = parseDateOnly(rawRow[mapping.inicio_programado])

  if (!ordemCodigo) {
    return { status: 'invalid', reason: 'ordem_codigo_ausente', rowIndex }
  }

  if (!tipoOrdem) {
    return { status: 'invalid', reason: 'tipo_ordem_invalido', rowIndex, ordemCodigo }
  }

  const competenciaDate = getCompetenciaDate(tipoOrdem, dataEntrada, inicioProgramado)
  if (!competenciaDate) {
    return { status: 'invalid', reason: 'competencia_ausente', rowIndex, ordemCodigo, tipoOrdem }
  }

  return {
    status: 'valid',
    rowIndex,
    ordemCodigo,
    tipoOrdem,
    competenciaDate,
    competenciaYear: getYearFromIsoDate(competenciaDate),
    payload: {
      ordem_codigo: ordemCodigo,
      tipo_ordem: tipoOrdem,
      numero_nota: null,
      data_entrada: dataEntrada,
      inicio_programado: inicioProgramado,
      denominacao_unidade: normalizeOptionalText(rawRow[mapping.denominacao_unidade]),
      texto_breve: normalizeOptionalText(rawRow[mapping.texto_breve]),
      fornecedor_codigo: normalizeOptionalText(rawRow[mapping.fornecedor_codigo]),
      fornecedor_nome: normalizeOptionalText(rawRow[mapping.fornecedor_nome]),
      custos_estimados: normalizeMoney(rawRow[mapping.custos_estimados]),
      custos_totais_materiais: normalizeMoney(rawRow[mapping.custos_totais_materiais]),
      custos_adicionais: normalizeMoney(rawRow[mapping.custos_adicionais]),
      custos_totais_reais: normalizeMoney(rawRow[mapping.custos_totais_reais]),
      source_file_name: sourceTag,
      raw_payload: rawRow,
    },
  }
}

function parseWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Planilha sem abas')
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  })

  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  return { sheetName: firstSheetName, rows, headers }
}

function buildHistoricalCandidates(rows, mapping, options) {
  const counters = {
    totalRead: rows.length,
    invalid: 0,
    invalidReasons: {},
    outOfWindow: 0,
    duplicateInFile: 0,
    eligible: 0,
    byYearType: {},
  }

  const deduped = new Map()

  rows.forEach((rawRow, index) => {
    const normalized = normalizeRow(rawRow, index + 2, mapping, options.sourceTag)
    if (normalized.status !== 'valid') {
      counters.invalid += 1
      incrementCounter(counters.invalidReasons, normalized.reason)
      return
    }

    if (!isCompetenciaInRange(normalized.competenciaDate, options.fromYear, options.toYear)) {
      counters.outOfWindow += 1
      return
    }

    if (deduped.has(normalized.ordemCodigo)) {
      counters.duplicateInFile += 1
    }

    deduped.set(normalized.ordemCodigo, normalized)
  })

  const candidates = Array.from(deduped.values())
  for (const candidate of candidates) {
    counters.eligible += 1
    incrementCounter(
      counters.byYearType,
      buildYearTypeKey(candidate.competenciaYear, candidate.tipoOrdem),
    )
  }

  return { candidates, counters }
}

function loadDotEnv(rootDir) {
  const envPath = path.join(rootDir, '.env')
  if (!fs.existsSync(envPath)) return

  const contents = fs.readFileSync(envPath, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key || process.env[key]) continue

    let value = trimmed.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_URL nao configurada')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_KEY nao configurada')
  }

  return { supabaseUrl, serviceRoleKey }
}

function createAdminClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function fetchExistingCodes(supabase, orderCodes) {
  const existingCodes = new Set()

  for (const chunk of chunkArray(orderCodes, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('ordens_financeiro_importado')
      .select('ordem_codigo')
      .in('ordem_codigo', chunk)

    if (error) {
      throw new Error(`Erro ao buscar ordens existentes: ${error.message}`)
    }

    for (const row of data ?? []) {
      if (row.ordem_codigo) existingCodes.add(String(row.ordem_codigo))
    }
  }

  return existingCodes
}

async function insertHistoricalRows(supabase, payloads) {
  let inserted = 0
  const insertedCodes = []

  for (const batch of chunkArray(payloads, INSERT_BATCH_SIZE)) {
    const { error } = await supabase
      .from('ordens_financeiro_importado')
      .insert(batch)

    if (error) {
      throw new Error(`Erro ao inserir batch historico: ${error.message}`)
    }

    inserted += batch.length
    insertedCodes.push(...batch.map((row) => row.ordem_codigo))
  }

  return { inserted, insertedCodes }
}

async function backfillOrdersDates(supabase, orderCodes) {
  let updated = 0

  for (const chunk of chunkArray(orderCodes, RPC_CHUNK_SIZE)) {
    const { data, error } = await supabase.rpc('backfill_data_entrada_from_financeiro', {
      p_codigos: chunk,
    })

    if (error) {
      throw new Error(`Erro ao executar backfill_data_entrada_from_financeiro: ${error.message}`)
    }

    updated += Number(data ?? 0)
  }

  return updated
}

async function fetchFinanceSummaryByYearAndType(supabase, fromYear, toYear) {
  const summary = {}
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('vw_financeiro_ordens')
      .select('competencia_ano, tipo_ordem, ordem_codigo')
      .gte('competencia_ano', fromYear)
      .lte('competencia_ano', toYear)
      .order('competencia_ano', { ascending: true })
      .order('tipo_ordem', { ascending: true })
      .order('ordem_codigo', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) {
      throw new Error(`Erro ao consultar resumo financeiro: ${error.message}`)
    }

    const rows = data ?? []
    for (const row of rows) {
      const year = Number(row.competencia_ano)
      const tipo = String(row.tipo_ordem)
      incrementCounter(summary, buildYearTypeKey(year, tipo))
    }

    if (rows.length < pageSize) break
    from += rows.length
  }

  return summary
}

function toSortedObject(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right, 'pt-BR')),
  )
}

function buildDryRunReport(params) {
  return {
    file: params.filePath,
    sheet: params.sheetName,
    range: `${params.fromYear}-${params.toYear}`,
    sourceTag: params.sourceTag,
    totalRead: params.counters.totalRead,
    invalid: params.counters.invalid,
    invalidReasons: toSortedObject(params.counters.invalidReasons),
    outOfWindow: params.counters.outOfWindow,
    duplicateInFile: params.counters.duplicateInFile,
    eligible: params.counters.eligible,
    existingInDatabase: params.existingCount,
    toInsert: params.toInsertCount,
    byYearType: toSortedObject(params.counters.byYearType),
  }
}

function parseCliArgs(argv) {
  const args = {
    file: null,
    fromYear: DEFAULT_FROM_YEAR,
    toYear: DEFAULT_TO_YEAR,
    dryRun: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--file') {
      args.file = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (current === '--from-year') {
      args.fromYear = Number(argv[index + 1] ?? DEFAULT_FROM_YEAR)
      index += 1
      continue
    }
    if (current === '--to-year') {
      args.toYear = Number(argv[index + 1] ?? DEFAULT_TO_YEAR)
      index += 1
      continue
    }
    if (current === '--execute') {
      args.dryRun = false
      continue
    }
    if (current === '--dry-run') {
      args.dryRun = true
    }
  }

  if (!args.file) {
    throw new Error('Uso: node scripts/backfill_financeiro_historico.js --file <arquivo.xlsx> [--from-year 2022] [--to-year 2025] [--execute]')
  }

  if (!Number.isInteger(args.fromYear) || !Number.isInteger(args.toYear) || args.fromYear > args.toYear) {
    throw new Error('Intervalo de anos invalido')
  }

  return args
}

async function runBackfill(options) {
  const rootDir = options.rootDir ?? process.cwd()
  loadDotEnv(rootDir)

  const filePath = path.resolve(rootDir, options.file)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo nao encontrado: ${filePath}`)
  }

  const { sheetName, rows, headers } = parseWorkbookRows(filePath)
  const mapping = autoDetectMapping(headers)
  const missingRequiredMappings = ['ordem_codigo', 'tipo_ordem', 'data_entrada', 'inicio_programado']
    .filter((field) => !mapping[field])

  if (missingRequiredMappings.length > 0) {
    throw new Error(`Colunas obrigatorias nao encontradas: ${missingRequiredMappings.join(', ')}`)
  }

  const sourceTag = buildSourceTag(filePath, options.fromYear, options.toYear)
  const { candidates, counters } = buildHistoricalCandidates(rows, mapping, {
    fromYear: options.fromYear,
    toYear: options.toYear,
    sourceTag,
  })

  const supabase = createAdminClient()
  const existingCodes = await fetchExistingCodes(
    supabase,
    candidates.map((candidate) => candidate.ordemCodigo),
  )

  const toInsertCandidates = candidates.filter((candidate) => !existingCodes.has(candidate.ordemCodigo))
  const report = buildDryRunReport({
    filePath,
    sheetName,
    fromYear: options.fromYear,
    toYear: options.toYear,
    sourceTag,
    counters,
    existingCount: existingCodes.size,
    toInsertCount: toInsertCandidates.length,
  })

  if (options.dryRun) {
    return {
      dryRun: true,
      report,
    }
  }

  const beforeSummary = await fetchFinanceSummaryByYearAndType(supabase, options.fromYear, options.toYear)
  const payloads = toInsertCandidates.map((candidate) => candidate.payload)
  const { inserted, insertedCodes } = await insertHistoricalRows(supabase, payloads)
  const backfilledOrders = insertedCodes.length > 0
    ? await backfillOrdersDates(supabase, insertedCodes)
    : 0
  const afterSummary = await fetchFinanceSummaryByYearAndType(supabase, options.fromYear, options.toYear)

  return {
    dryRun: false,
    report,
    inserted,
    backfilledOrders,
    beforeSummary: toSortedObject(beforeSummary),
    afterSummary: toSortedObject(afterSummary),
  }
}

module.exports = {
  DEFAULT_FROM_YEAR,
  DEFAULT_TO_YEAR,
  FIELD_ALIASES,
  autoDetectMapping,
  buildHistoricalCandidates,
  buildSourceTag,
  createAdminClient,
  fetchFinanceSummaryByYearAndType,
  getCompetenciaDate,
  isCompetenciaInRange,
  loadDotEnv,
  normalizeHeaderKey,
  normalizeMoney,
  normalizeOptionalText,
  normalizeRow,
  parseCliArgs,
  parseDateOnly,
  parseWorkbookRows,
  runBackfill,
}
