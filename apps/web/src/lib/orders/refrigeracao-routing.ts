function normalizeOrderCode(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function normalizeRoutingText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

const AUTOMOTIVE_AIR_HINTS = [
  'VEICULO',
  'VEICULAR',
  'AUTOMOT',
  'CARRO',
  'FROTA',
  'CAMINHAO',
  'CAMINHONETE',
  'MOTO',
  'ONIBUS',
] as const

const STRONG_REFRIGERACAO_HINTS = [
  'BTUS',
  'VRF',
  'CHILLER',
  'SPLITAO',
  'CENTRAIS DE AR',
] as const

const SUELEM_TEXTO_BREVE_ALWAYS_ROUTE = new Set([
  'AR CONDICIONADO (ATE 60.000 BTUS)',
])

const SUELEM_PMOS_KEEP_CODES = new Set([
  '5222465',
  '5223492',
  '5224147',
  '5221929',
  '5212399',
  '5215367',
  '5217322',
  '5217323',
  '5220885',
  '5220963',
  '5221053',
  '5221054',
  '5221122',
  '5221300',
  '5221301',
  '5221302',
  '5221391',
  '5221393',
  '5221394',
  '5221395',
  '5221396',
  '5221423',
  '5221503',
  '5221506',
  '5221534',
  '5221786',
  '5221864',
  '5221867',
  '5221887',
  '5221905',
  '5221906',
  '5222034',
  '5222035',
  '5222116',
  '5222117',
  '5222170',
  '5222193',
  '5222212',
  '5222391',
  '5222435',
  '5222436',
  '5222468',
  '5222469',
  '5222473',
  '5222498',
  '5222506',
  '5222507',
  '5222508',
  '5222509',
  '5222510',
  '5222511',
  '5222512',
  '5222513',
  '5222514',
  '5222515',
  '5222516',
  '5222517',
  '5222663',
  '5222675',
  '5222708',
  '5222737',
  '5222738',
  '5222739',
  '5222767',
  '5222779',
  '5222820',
  '5222906',
  '5222980',
  '5222981',
  '5222982',
  '5222985',
  '5222986',
  '5223134',
  '5223191',
  '5223194',
  '5223195',
  '5223258',
  '5223281',
  '5223282',
  '5223295',
  '5223328',
  '5223329',
  '5223340',
  '5223341',
  '5223491',
  '5223551',
  '5223562',
  '5223761',
  '5223762',
  '5223763',
  '5223899',
  '5224021',
  '5221865',
  '5222147',
  '5222662',
  '5222777',
  '5223553',
  '5223561',
  '5223861',
  '5210126',
  '5221866',
  '5222208',
  '5222214',
  '5222338',
  '5222432',
  '5222433',
  '5222499',
  '5222503',
  '5222561',
  '5222562',
  '5222563',
  '5222709',
  '5222711',
  '5222712',
  '5222768',
  '5222773',
  '5222827',
  '5222921',
  '5222922',
  '5222923',
  '5222924',
  '5222925',
  '5222926',
  '5222927',
  '5222973',
  '5222979',
  '5222992',
  '5223014',
  '5223015',
  '5223016',
  '5223017',
  '5223018',
  '5223019',
  '5223162',
  '5223259',
  '5223280',
  '5223289',
  '5223390',
  '5223490',
  '5223552',
  '5223760',
  '5223894',
  '5221303',
  '5221928',
  '5222057',
  '5222058',
  '5222096',
  '5222119',
  '5222222',
  '5222223',
  '5222224',
  '5222225',
  '5222226',
  '5222227',
  '5222350',
  '5222358',
  '5222439',
  '5222518',
  '5222560',
  '5222620',
  '5222621',
  '5222622',
  '5222623',
  '5222635',
  '5222660',
  '5222661',
  '5222664',
  '5222770',
  '5222771',
  '5222772',
  '5222968',
  '5222969',
  '5223193',
  '5223290',
  '5223291',
  '5223292',
  '5223293',
  '5223294',
  '5223700',
  '5223860',
  '5224000',
])

export function shouldKeepRefrigeracaoOrderWithSuelem(ordemCodigo: string | null | undefined): boolean {
  const normalized = normalizeOrderCode(ordemCodigo)
  if (!normalized) return false
  return SUELEM_PMOS_KEEP_CODES.has(normalized)
}

export function isSuelemKeepOrderCode(ordemCodigo: string | null | undefined): boolean {
  return shouldKeepRefrigeracaoOrderWithSuelem(ordemCodigo)
}

export function shouldForceSuelemByTextoBreve(textoBreve: string | null | undefined): boolean {
  const normalized = normalizeRoutingText(textoBreve)
  if (!normalized) return false
  return SUELEM_TEXTO_BREVE_ALWAYS_ROUTE.has(normalized)
}

function hasStrongRefrigeracaoHint(text: string, keywords: readonly string[]): boolean {
  if (STRONG_REFRIGERACAO_HINTS.some((hint) => text.includes(hint))) {
    return true
  }

  return keywords
    .map((keyword) => normalizeRoutingText(keyword))
    .filter((keyword) => STRONG_REFRIGERACAO_HINTS.some((hint) => keyword.includes(hint)))
    .some((keyword) => text.includes(keyword))
}

export function shouldRouteOrderToRefrigeracao(params: {
  textoBreve: string | null | undefined
  descricao: string | null | undefined
  keywords?: readonly string[]
}): boolean {
  const sourceText = normalizeRoutingText(params.textoBreve) || normalizeRoutingText(params.descricao)
  if (!sourceText) return false

  if (AUTOMOTIVE_AIR_HINTS.some((hint) => sourceText.includes(hint))) {
    return false
  }

  return hasStrongRefrigeracaoHint(sourceText, params.keywords ?? [])
}
