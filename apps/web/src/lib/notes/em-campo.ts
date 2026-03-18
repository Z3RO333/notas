import type {
  NotesEmCampoData,
  NotesEmCampoHint,
  NotesEmCampoOperationalSuggestion,
  NotesEmCampoSuggestionTarget,
} from '@/lib/types/database'

type ResolvedNotesEmCampoHint = NotesEmCampoHint

type HintRule = {
  keywords: string[]
  prioridade: NotesEmCampoHint['prioridade']
  mensagem: string
}

const HINT_RULES: HintRule[] = [
  {
    keywords: [
      'instalacao eletrica',
      'instalacoes eletricas',
      'eletrica',
      'eletrico',
      'painel eletrico',
    ],
    prioridade: 'interno',
    mensagem: 'Instalacao Eletrica: priorize o operacional que ja estiver atendendo a loja; sem isso, use o menor carregamento atual.',
  },
  {
    keywords: [
      'ar condicionado',
      'ar-condicionado',
      'ar cond',
      'centrais de ar',
      'central de ar',
      'vrf',
      'chiller',
      'splitao',
      'split',
      'freezer',
      'geladeira',
      'refrigeracao',
      'btus',
    ],
    prioridade: 'interno',
    mensagem: 'Refrigeracao: priorize quem ja estiver na loja; sem esse encaixe, use o melhor historico do servico com menor carga em campo.',
  },
  {
    keywords: [
      'elevador',
      'escada rolante',
      'subestacao',
      'gerador',
      'grupo gerador',
      'monta carga',
      'monta-carga',
      'plataforma',
    ],
    prioridade: 'equilibrado',
    mensagem: 'Compare quem ja atende a loja com o historico do servico para distribuir sem pulverizar demais a unidade.',
  },
]

const SERVICE_STOP_WORDS = new Set([
  'a',
  'as',
  'ate',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'para',
  'por',
])

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function tokenizeText(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !SERVICE_STOP_WORDS.has(token))
}

function resolveNotesEmCampoHint(service: string | null | undefined): ResolvedNotesEmCampoHint {
  const normalizedService = normalizeText(service)

  if (!normalizedService) {
    return {
      prioridade: 'equilibrado',
      mensagem: 'Selecione loja e servico para habilitar a correlacao; sem esse refinamento, o modal mostra apenas a carga atual dos operacionais.',
    }
  }

  const matchedRule = HINT_RULES.find((rule) => (
    rule.keywords.some((keyword) => normalizedService.includes(normalizeText(keyword)))
  ))

  if (matchedRule) {
    return {
      prioridade: matchedRule.prioridade,
      mensagem: matchedRule.mensagem,
    }
  }

  return {
    prioridade: 'equilibrado',
    mensagem: 'Use quem ja atende a loja e o historico do servico para distribuir com mais consistencia.',
  }
}

export function inferNotesEmCampoService(
  description: string | null | undefined,
  knownServices: string[],
): string | null {
  const normalizedDescription = normalizeText(description)

  if (!normalizedDescription) return null

  let bestService: string | null = null
  let bestScore = -1

  for (const service of knownServices) {
    const normalizedService = normalizeText(service)
    if (!normalizedService) continue

    let score = -1

    if (normalizedDescription.includes(normalizedService) || normalizedService.includes(normalizedDescription)) {
      score = normalizedService.length + 10_000
    } else {
      const serviceTokens = tokenizeText(service)
      if (serviceTokens.length === 0) continue

      const matchedTokens = serviceTokens.filter((token) => normalizedDescription.includes(token))
      if (matchedTokens.length === 0) continue

      score = matchedTokens.length * 100 + matchedTokens.reduce((total, token) => total + token.length, 0)

      if (matchedTokens.length === serviceTokens.length) {
        score += 1_000
      }
    }

    if (score > bestScore || (score === bestScore && service.length > (bestService?.length ?? 0))) {
      bestService = service
      bestScore = score
    }
  }

  return bestService
}

export function rankNotesEmCampoOperationalSuggestions(
  suggestions: NotesEmCampoOperationalSuggestion[],
): NotesEmCampoOperationalSuggestion[] {
  return [...suggestions].sort((a, b) => {
    if (a.ordens_mesma_loja_ativas !== b.ordens_mesma_loja_ativas) {
      return b.ordens_mesma_loja_ativas - a.ordens_mesma_loja_ativas
    }
    if (a.historico_loja_servico !== b.historico_loja_servico) {
      return b.historico_loja_servico - a.historico_loja_servico
    }
    if (a.total_em_campo !== b.total_em_campo) {
      return a.total_em_campo - b.total_em_campo
    }
    if (a.historico_servico_geral !== b.historico_servico_geral) {
      return b.historico_servico_geral - a.historico_servico_geral
    }
    return a.fornecedor_nome.localeCompare(b.fornecedor_nome, 'pt-BR')
  })
}

export function pickNotesEmCampoSuggestionTarget(params: {
  suggestions?: NotesEmCampoOperationalSuggestion[]
}): NotesEmCampoSuggestionTarget | null {
  const suggestion = rankNotesEmCampoOperationalSuggestions(params.suggestions ?? [])[0] ?? null

  if (!suggestion) return null

  return {
    tipo: 'operacional',
    codigo: suggestion.fornecedor_codigo,
    nome: suggestion.fornecedor_nome,
    ordens_mesma_loja_ativas: suggestion.ordens_mesma_loja_ativas,
    historico_loja_servico: suggestion.historico_loja_servico,
    historico_servico_geral: suggestion.historico_servico_geral,
    match_mode: suggestion.match_mode,
  }
}

export function buildNotesEmCampoConsolidationMessage(params: {
  loja: string | null
  target: NotesEmCampoSuggestionTarget | null
}): string | null {
  const loja = params.loja?.trim()
  const target = params.target

  if (!loja || !target || target.ordens_mesma_loja_ativas <= 0) return null

  const suffix = target.ordens_mesma_loja_ativas === 1 ? 'ordem' : 'ordens'
  return `${target.nome} ja tem ${target.ordens_mesma_loja_ativas} ${suffix} em ${loja}. Vale consolidar esta nota com ele.`
}

export function buildNotesEmCampoData(params: {
  service: string | null | undefined
  operationals?: NotesEmCampoOperationalSuggestion[]
}): NotesEmCampoData {
  const hint = resolveNotesEmCampoHint(params.service)

  return {
    operacionais: rankNotesEmCampoOperationalSuggestions(params.operationals ?? []),
    hint: {
      prioridade: hint.prioridade,
      mensagem: hint.mensagem,
    },
  }
}
