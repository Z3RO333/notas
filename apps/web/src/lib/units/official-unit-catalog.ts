import type { TipoUnidade } from '@/lib/types/database'

export type OfficialPrimaryUnitCategory = TipoUnidade | 'MERCADO' | 'SUPORTE'
export type OfficialReferenceCategory = OfficialPrimaryUnitCategory | 'LOTERIA'

export interface OfficialUnitEntry {
  centro: string
  unidade: string
  categoria: OfficialPrimaryUnitCategory
  countedInKpi: boolean
}

type RawOfficialUnit = Pick<OfficialUnitEntry, 'centro' | 'unidade'>

const OFFICIAL_STORE_UNITS: RawOfficialUnit[] = [
  { centro: '101', unidade: 'Loja Matriz' },
  { centro: '103', unidade: 'Loja Avenida' },
  { centro: '105', unidade: 'Loja Educandos' },
  { centro: '106', unidade: 'Loja Amazonas Shopping' },
  { centro: '109', unidade: 'Loja Grande Circular' },
  { centro: '114', unidade: 'Loja Ponta Negra' },
  { centro: '115', unidade: 'Loja Cidade Nova' },
  { centro: '116', unidade: 'Loja Studio 5' },
  { centro: '118', unidade: 'Loja Camapua' },
  { centro: '119', unidade: 'Loja Manauara' },
  { centro: '120', unidade: 'Loja Shopping Ponta Negra' },
  { centro: '121', unidade: 'Loja Nova Cidade' },
  { centro: '500', unidade: 'Loja Torquato' },
  { centro: '510', unidade: 'Loja Itacoatiara' },
  { centro: '520', unidade: 'Loja Manacapuru' },
  { centro: '530', unidade: 'Loja Presidente Figueiredo' },
  { centro: '531', unidade: 'Loja Autazes' },
  { centro: '550', unidade: 'Loja Iranduba' },
  { centro: '560', unidade: 'Loja Rio Preto da Eva' },
  { centro: '561', unidade: 'Loja Codajas' },
  { centro: '570', unidade: 'Loja Manaquiri' },
  { centro: '580', unidade: 'Loja Careiro' },
  { centro: '590', unidade: 'Loja Parintins' },
  { centro: '591', unidade: 'Loja Coari' },
  { centro: '592', unidade: 'Loja Maues' },
  { centro: '201', unidade: 'Loja Porto Velho Centro' },
  { centro: '202', unidade: 'Loja Porto Velho Shopping' },
  { centro: '204', unidade: 'Loja Jatuarana' },
  { centro: '205', unidade: 'Loja Ji-Parana' },
  { centro: '206', unidade: 'Loja Ariquemes' },
  { centro: '207', unidade: 'Loja Buritis' },
  { centro: '701', unidade: 'Loja Boa Vista Shopping' },
  { centro: '702', unidade: 'Loja Ataide Teive' },
  { centro: '703', unidade: 'Loja Rorainopolis' },
  { centro: '705', unidade: 'Loja Getulio Vargas' },
  { centro: '706', unidade: 'Loja Major Williams' },
  { centro: '401', unidade: 'Loja Rio Branco' },
  { centro: '404', unidade: 'Loja Cruzeiro do Sul' },
]

const OFFICIAL_FARMA_UNITS: RawOfficialUnit[] = [
  { centro: '601', unidade: 'Farma Torquato' },
  { centro: '602', unidade: 'Farma Camapua' },
  { centro: '603', unidade: 'Farma Amazonas Shopping' },
  { centro: '604', unidade: 'Farma Grande Circular' },
  { centro: '605', unidade: 'Farma Matriz' },
  { centro: '607', unidade: 'Farma Nova Cidade' },
  { centro: '609', unidade: 'Farma Porto Velho Centro' },
  { centro: '610', unidade: 'Farma Boa Vista' },
  { centro: '611', unidade: 'Farma Itacoatiara' },
  { centro: '612', unidade: 'Farma Manauara' },
  { centro: '614', unidade: 'Farma Presidente Figueiredo' },
  { centro: '615', unidade: 'Farma Djalma' },
  { centro: '616', unidade: 'Farma Ponta Negra Shopping' },
  { centro: '617', unidade: 'Farma Ponta Negra DB' },
  { centro: '618', unidade: 'Farma Studio 5' },
  { centro: '619', unidade: 'Farma Jatuarana' },
  { centro: '620', unidade: 'Farma Avenida' },
  { centro: '621', unidade: 'Farma Cidade Nova' },
  { centro: '622', unidade: 'Farma Autazes' },
  { centro: '623', unidade: 'Farma Ataide Teive' },
  { centro: '624', unidade: 'Farma Manacapuru' },
  { centro: '625', unidade: 'Farma Rio Branco' },
  { centro: '626', unidade: 'Farma Rorainopolis' },
  { centro: '627', unidade: 'Farma Getulio Vargas' },
  { centro: '629', unidade: 'Farma Rio Preto' },
  { centro: '630', unidade: 'Farma Codajas' },
  { centro: '631', unidade: 'Farma Porto Velho Shopping' },
  { centro: '632', unidade: 'Farma Cruzeiro do Sul' },
  { centro: '633', unidade: 'Farma Manaquiri' },
  { centro: '634', unidade: 'Farma Major Williams' },
  { centro: '635', unidade: 'Farma Careiro' },
  { centro: '636', unidade: 'Farma Dom Pedro' },
  { centro: '637', unidade: 'Farma Boulevard' },
  { centro: '638', unidade: 'Farma Iranduba' },
  { centro: '639', unidade: 'Farma Parintins' },
  { centro: '640', unidade: 'Farma Coari' },
  { centro: '641', unidade: 'Farma Educandos' },
  { centro: '642', unidade: 'Farma Via Norte' },
  { centro: '643', unidade: 'Farma Efigenio Salles' },
  { centro: '644', unidade: 'Farma Franceses' },
  { centro: '645', unidade: 'Farma Coroado' },
  { centro: '646', unidade: 'Farma Maues' },
  { centro: '647', unidade: 'Farma Torres' },
  { centro: '648', unidade: 'Farma Noel Nutels' },
  { centro: '649', unidade: 'Farma Flores' },
]

const OFFICIAL_CD_UNITS: RawOfficialUnit[] = [
  { centro: '104', unidade: 'CD Torquato' },
  { centro: '148', unidade: 'CD Turismo' },
  { centro: '203', unidade: 'CD Porto Velho' },
  { centro: '402', unidade: 'CD Rio Branco' },
  { centro: '704', unidade: 'CD Boa Vista' },
]

// Inference from the workbook: these are the four remaining comercial centers
// after the explicit loja/farma/CD lists are applied.
const OFFICIAL_MARKET_UNITS: RawOfficialUnit[] = [
  { centro: '145', unidade: 'Mercado BOL' },
  { centro: '151', unidade: 'Mercado BOL Turismo' },
  { centro: '801', unidade: 'Mercado Camapua' },
  { centro: '850', unidade: 'Bemol Saude' },
]

const OFFICIAL_EXCLUDED_UNITS: RawOfficialUnit[] = [
  { centro: '100', unidade: 'Escritorio' },
  { centro: '102', unidade: 'Online' },
  { centro: '122', unidade: 'Televendas Varejo' },
  { centro: '123', unidade: 'Televendas Varejo 1' },
  { centro: '144', unidade: 'CD Mercado' },
  { centro: '149', unidade: 'CD Farma Turismo' },
  { centro: '170', unidade: 'CD Porto' },
  { centro: '600', unidade: 'Farma Online' },
  { centro: '606', unidade: 'Farma Shopping Ponta Negra' },
  { centro: '628', unidade: 'Farma BV Eduardo Gomes' },
  { centro: '696', unidade: 'Televendas Farma' },
  { centro: '699', unidade: 'Farma BOL Torres' },
]

export const OFFICIAL_REFERENCE_TOTALS: Record<OfficialReferenceCategory, number> = {
  LOJA: OFFICIAL_STORE_UNITS.length,
  FARMA: OFFICIAL_FARMA_UNITS.length,
  CD: OFFICIAL_CD_UNITS.length,
  MERCADO: OFFICIAL_MARKET_UNITS.length,
  SUPORTE: OFFICIAL_EXCLUDED_UNITS.length,
  LOTERIA: 22,
}

export const OFFICIAL_UNIT_CATALOG: OfficialUnitEntry[] = [
  ...OFFICIAL_STORE_UNITS.map((entry) => ({ ...entry, categoria: 'LOJA' as const, countedInKpi: true })),
  ...OFFICIAL_FARMA_UNITS.map((entry) => ({ ...entry, categoria: 'FARMA' as const, countedInKpi: true })),
  ...OFFICIAL_CD_UNITS.map((entry) => ({ ...entry, categoria: 'CD' as const, countedInKpi: true })),
  ...OFFICIAL_MARKET_UNITS.map((entry) => ({ ...entry, categoria: 'MERCADO' as const, countedInKpi: true })),
  ...OFFICIAL_EXCLUDED_UNITS.map((entry) => ({ ...entry, categoria: 'SUPORTE' as const, countedInKpi: false })),
]

const LEGACY_INFLATION_GROUPS = {
  LOJA: new Set(['100', '102', '122', '123', '145', '151', '801', '850']),
  FARMA: new Set(['600', '606', '628', '696', '699']),
  CD: new Set(['144', '149', '170']),
} as const

const SUPPLEMENTAL_CENTERS = new Set(['207', '616'])
const GESTAO_BASE_TYPES: TipoUnidade[] = ['LOJA', 'FARMA', 'CD']

function sortByCentro(left: OfficialUnitEntry, right: OfficialUnitEntry): number {
  return Number(left.centro) - Number(right.centro)
}

export function getOfficialUnitEntries(category: OfficialPrimaryUnitCategory): OfficialUnitEntry[] {
  return OFFICIAL_UNIT_CATALOG.filter((entry) => entry.categoria === category)
}

export function getOfficialKpiCount(category: TipoUnidade | 'MERCADO'): number {
  return OFFICIAL_REFERENCE_TOTALS[category]
}

export function getOfficialGestaoUniverseCount(unitType: TipoUnidade | 'todos'): number {
  if (unitType === 'todos') {
    return GESTAO_BASE_TYPES.reduce((sum, type) => sum + getOfficialKpiCount(type), 0)
  }

  return getOfficialKpiCount(unitType)
}

export function getOfficialGestaoUniverseNames(unitType: TipoUnidade | 'todos'): string[] {
  const allowedTypes = unitType === 'todos'
    ? new Set<TipoUnidade>(GESTAO_BASE_TYPES)
    : new Set<TipoUnidade>([unitType])

  return OFFICIAL_UNIT_CATALOG
    .filter((entry) => entry.countedInKpi && allowedTypes.has(entry.categoria as TipoUnidade))
    .map((entry) => entry.unidade)
}

export function getOfficialUnitAudit() {
  return {
    excludedEntries: getOfficialUnitEntries('SUPORTE').sort(sortByCentro),
    supplementalEntries: OFFICIAL_UNIT_CATALOG.filter((entry) => SUPPLEMENTAL_CENTERS.has(entry.centro)).sort(sortByCentro),
    legacyInflation: {
      LOJA: OFFICIAL_UNIT_CATALOG.filter((entry) => LEGACY_INFLATION_GROUPS.LOJA.has(entry.centro)).sort(sortByCentro),
      FARMA: OFFICIAL_UNIT_CATALOG.filter((entry) => LEGACY_INFLATION_GROUPS.FARMA.has(entry.centro)).sort(sortByCentro),
      CD: OFFICIAL_UNIT_CATALOG.filter((entry) => LEGACY_INFLATION_GROUPS.CD.has(entry.centro)).sort(sortByCentro),
    },
    loteriaNote:
      'Loterias ficaram como recorte oficial paralelo da planilha: o resumo soma 114 ocorrencias sobre 104 centros unicos, entao esse total nao pode ser tratado como categoria primaria sem duplicar unidade.',
  }
}
