const test = require('node:test')
const assert = require('node:assert/strict')

const {
  autoDetectMapping,
  buildHistoricalCandidates,
  buildSourceTag,
  getCompetenciaDate,
  isCompetenciaInRange,
  normalizeMoney,
  normalizeRow,
  parseCliArgs,
  parseDateOnly,
} = require('../lib/backfill_financeiro_historico')

const mapping = {
  ordem_codigo: 'Ordem',
  tipo_ordem: 'Tipo de ordem',
  data_entrada: 'Data de entrada',
  inicio_programado: 'Inicio prog.',
  denominacao_unidade: 'Denominacao',
  texto_breve: 'Texto breve',
  fornecedor_codigo: 'Fornecedor',
  fornecedor_nome: 'Nome Fornecedor CT',
  custos_estimados: 'Custs.estimados',
  custos_totais_materiais: 'Custos tot.mat.',
  custos_adicionais: 'Custs.adicionais',
  custos_totais_reais: 'Cust.tot.reais',
}

test('autoDetectMapping reconhece Inicio prog. e permite numero_nota ausente', () => {
  const headers = [
    'Tipo de ordem',
    'Ordem',
    'Início prog.',
    'Data de entrada',
    'Denominação',
    'Texto breve',
    'Fornecedor',
    'Nome Fornecedor CT',
    'Custs.estimados',
    'Custos tot.mat.',
    'Custs.adicionais',
    'Cust.tot.reais',
  ]

  const detected = autoDetectMapping(headers)
  assert.equal(detected.inicio_programado, 'Início prog.')
  assert.equal(detected.ordem_codigo, 'Ordem')
  assert.equal(detected.data_entrada, 'Data de entrada')
})

test('parseDateOnly suporta Date, ISO, datetime e serial do Excel', () => {
  assert.equal(parseDateOnly(new Date('2025-03-10T12:00:00Z')), '2025-03-10')
  assert.equal(parseDateOnly('2025-03-10'), '2025-03-10')
  assert.equal(parseDateOnly('2025-03-10 00:00:00'), '2025-03-10')
  assert.equal(parseDateOnly(45726), '2025-03-10')
})

test('normalizeMoney converte formatos BR e US', () => {
  assert.equal(normalizeMoney('1.234,56'), 1234.56)
  assert.equal(normalizeMoney('1,234.56'), 1234.56)
  assert.equal(normalizeMoney(null), 0)
})

test('normalizeRow aceita numero_nota ausente e usa competencia de PMPL via inicio_programado', () => {
  const row = {
    Ordem: '5123456',
    'Tipo de ordem': 'PMPL',
    'Data de entrada': '2025-01-02 00:00:00',
    'Inicio prog.': '2025-04-15 00:00:00',
    Denominacao: 'Loja A',
    'Texto breve': 'Preventiva',
    Fornecedor: '123',
    'Nome Fornecedor CT': 'Fornecedor A',
    'Custs.estimados': 100,
    'Custos tot.mat.': 20,
    'Custs.adicionais': 5,
    'Cust.tot.reais': 0,
  }

  const normalized = normalizeRow(row, 2, mapping, buildSourceTag('arquivo.xlsx', 2022, 2025))
  assert.equal(normalized.status, 'valid')
  assert.equal(normalized.payload.numero_nota, null)
  assert.equal(normalized.payload.inicio_programado, '2025-04-15')
  assert.equal(normalized.competenciaDate, '2025-04-15')
})

test('normalizeRow aceita PMPL sem inicio_programado quando data_entrada existe e invalida linha sem competencia', () => {
  const missingInicio = normalizeRow({
    Ordem: '5123456',
    'Tipo de ordem': 'PMPL',
    'Data de entrada': '2025-01-02',
    'Inicio prog.': null,
  }, 2, mapping, 'source')

  const missingCompetencia = normalizeRow({
    Ordem: '600',
    'Tipo de ordem': 'PMPL',
    'Data de entrada': null,
    'Inicio prog.': null,
  }, 3, mapping, 'source')

  assert.equal(missingInicio.status, 'valid')
  assert.equal(missingInicio.competenciaDate, '2025-01-02')
  assert.equal(missingCompetencia.status, 'invalid')
  assert.equal(missingCompetencia.reason, 'competencia_ausente')
})

test('competencia e filtro historico respeitam PMOS e PMPL', () => {
  assert.equal(getCompetenciaDate('PMOS', '2025-01-01', '2025-02-01'), '2025-01-01')
  assert.equal(getCompetenciaDate('PMPL', '2025-01-01', '2025-02-01'), '2025-02-01')
  assert.equal(getCompetenciaDate('PMPL', '2025-01-01', null), '2025-01-01')
  assert.equal(isCompetenciaInRange('2025-12-31', 2022, 2025), true)
  assert.equal(isCompetenciaInRange('2026-01-01', 2022, 2025), false)
})

test('buildHistoricalCandidates descarta invalidas, fora da janela e deduplica por ordem', () => {
  const rows = [
    {
      Ordem: '100',
      'Tipo de ordem': 'PMOS',
      'Data de entrada': '2025-01-05',
      'Inicio prog.': '2025-01-05',
    },
    {
      Ordem: '200',
      'Tipo de ordem': 'PMPL',
      'Data de entrada': '2025-12-28',
      'Inicio prog.': '2026-01-05',
    },
    {
      Ordem: '300',
      'Tipo de ordem': 'PMPL',
      'Data de entrada': '2025-03-01',
      'Inicio prog.': '2025-03-10',
    },
    {
      Ordem: '',
      'Tipo de ordem': 'PMOS',
      'Data de entrada': '2025-04-01',
      'Inicio prog.': '2025-04-01',
    },
    {
      Ordem: '100',
      'Tipo de ordem': 'PMOS',
      'Data de entrada': '2025-02-01',
      'Inicio prog.': '2025-02-01',
    },
  ]

  const { candidates, counters } = buildHistoricalCandidates(rows, mapping, {
    fromYear: 2022,
    toYear: 2025,
    sourceTag: 'source',
  })

  assert.equal(candidates.length, 2)
  assert.equal(counters.invalid, 1)
  assert.equal(counters.outOfWindow, 1)
  assert.equal(counters.duplicateInFile, 1)
  assert.deepEqual(counters.byYearType, {
    '2025-PMOS': 1,
    '2025-PMPL': 1,
  })
})

test('parseCliArgs usa dry-run por padrao e aceita execute', () => {
  const dry = parseCliArgs(['--file', 'arquivo.xlsx'])
  const execute = parseCliArgs(['--file', 'arquivo.xlsx', '--execute', '--from-year', '2023', '--to-year', '2024'])

  assert.equal(dry.file, 'arquivo.xlsx')
  assert.equal(dry.dryRun, true)
  assert.equal(execute.dryRun, false)
  assert.equal(execute.fromYear, 2023)
  assert.equal(execute.toYear, 2024)
})
