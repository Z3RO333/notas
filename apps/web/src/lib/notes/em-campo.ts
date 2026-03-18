import type { CollaboratorData } from '@/lib/types/collaborator'
import type {
  Especialidade,
  NotesEmCampoData,
  NotesEmCampoExternalSuggestion,
  NotesEmCampoHint,
  NotesEmCampoInternalSuggestion,
  NotesEmCampoSuggestionTarget,
} from '@/lib/types/database'

interface ResolvedNotesEmCampoHint extends NotesEmCampoHint {
  especialidadesPreferenciais: Especialidade[]
  forceInternalPrimary: boolean
}

type HintRule = {
  keywords: string[]
  prioridade: NotesEmCampoHint['prioridade']
  mensagem: string
  especialidadesPreferenciais: Especialidade[]
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
    mensagem: 'Instalacao Eletrica: priorize os internos com menor carga de ordens no momento.',
    especialidadesPreferenciais: ['geral'],
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
    mensagem: 'Refrigeracao: priorize os internos da especialidade e use externo como apoio quando a carga apertar.',
    especialidadesPreferenciais: ['refrigeracao'],
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
    mensagem: 'Elevadores, gerador e subestacao: compare os internos da especialidade com o melhor externo historico.',
    especialidadesPreferenciais: ['elevadores'],
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
      mensagem: 'Selecione loja e servico para habilitar a correlacao dos externos; sem esse refinamento, o modal mostra apenas a carga atual.',
      especialidadesPreferenciais: [],
      forceInternalPrimary: false,
    }
  }

  const matchedRule = HINT_RULES.find((rule) => (
    rule.keywords.some((keyword) => normalizedService.includes(normalizeText(keyword)))
  ))

  if (matchedRule) {
    return {
      prioridade: matchedRule.prioridade,
      mensagem: matchedRule.mensagem,
      especialidadesPreferenciais: matchedRule.especialidadesPreferenciais,
      forceInternalPrimary: matchedRule.prioridade === 'interno' && matchedRule.especialidadesPreferenciais.includes('geral'),
    }
  }

  return {
    prioridade: 'equilibrado',
    mensagem: 'Use a carga atual dos internos e o historico dos externos para equilibrar a distribuicao desta nota.',
    especialidadesPreferenciais: [],
    forceInternalPrimary: false,
  }
}

function toInternalSuggestion(collaborator: CollaboratorData): NotesEmCampoInternalSuggestion {
  return {
    admin_id: collaborator.id,
    nome: collaborator.nome,
    especialidade: collaborator.especialidade,
    qtd_ordens_ativas: collaborator.qtd_acompanhamento_ordens,
    qtd_notas_abertas: collaborator.qtd_abertas,
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

export function pickNotesEmCampoSuggestionTarget(params: {
  collaborators: CollaboratorData[]
  service: string | null | undefined
  externals?: NotesEmCampoExternalSuggestion[]
}): NotesEmCampoSuggestionTarget | null {
  const hint = resolveNotesEmCampoHint(params.service)
  const internal = rankNotesEmCampoInternals(params.collaborators, params.service)[0] ?? null
  const external = params.externals?.[0] ?? null

  if (external) {
    return {
      tipo: 'externo',
      codigo: external.fornecedor_codigo,
      nome: external.fornecedor_nome,
      historico_loja_servico: external.historico_loja_servico,
      historico_servico_geral: external.historico_servico_geral,
      match_mode: external.match_mode,
    }
  }

  if (hint.forceInternalPrimary && internal) {
    return {
      tipo: 'interno',
      codigo: internal.admin_id,
      nome: internal.nome,
      historico_loja_servico: 0,
      historico_servico_geral: 0,
      match_mode: null,
    }
  }

  if (internal) {
    return {
      tipo: 'interno',
      codigo: internal.admin_id,
      nome: internal.nome,
      historico_loja_servico: 0,
      historico_servico_geral: 0,
      match_mode: null,
    }
  }

  return null
}

export function rankNotesEmCampoInternals(
  collaborators: CollaboratorData[],
  service: string | null | undefined,
): NotesEmCampoInternalSuggestion[] {
  const hint = resolveNotesEmCampoHint(service)

  return collaborators
    .filter((collaborator) => collaborator.ativo && !collaborator.em_ferias && collaborator.recebe_distribuicao)
    .sort((a, b) => {
      const aPreferred = hint.especialidadesPreferenciais.includes(a.especialidade) ? 1 : 0
      const bPreferred = hint.especialidadesPreferenciais.includes(b.especialidade) ? 1 : 0

      if (aPreferred !== bPreferred) return bPreferred - aPreferred
      if (a.qtd_acompanhamento_ordens !== b.qtd_acompanhamento_ordens) {
        return a.qtd_acompanhamento_ordens - b.qtd_acompanhamento_ordens
      }
      if (a.qtd_abertas !== b.qtd_abertas) {
        return a.qtd_abertas - b.qtd_abertas
      }
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
    .map(toInternalSuggestion)
}

export function buildNotesEmCampoData(params: {
  collaborators: CollaboratorData[]
  service: string | null | undefined
  externals?: NotesEmCampoExternalSuggestion[]
}): NotesEmCampoData {
  const hint = resolveNotesEmCampoHint(params.service)

  return {
    internos: rankNotesEmCampoInternals(params.collaborators, params.service),
    externos: params.externals ?? [],
    hint: {
      prioridade: hint.prioridade,
      mensagem: hint.mensagem,
    },
  }
}
