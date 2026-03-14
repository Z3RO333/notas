import { buildAdminNoteStats, getSmartAgingCategory } from '@/lib/copilot/aging'
import { isOpenStatus } from '@/lib/collaborator/aging'
import type {
  CopilotAdminNoteStats,
  CopilotSuggestion,
  CopilotSuggestionDomain,
  NotaSample,
  SuggestionPriority,
  WorkloadRadarRow,
  IsoAdminRow,
} from '@/lib/types/copilot'
import type { NotaPanelData } from '@/lib/types/database'

let nextId = 0
function uid(): string {
  nextId += 1
  return `sug-${nextId}`
}

function buildHref(
  pathname: '/' | '/ordens',
  query: Record<string, string | number | null | undefined>
): string {
  const params = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === null || rawValue === undefined) continue
    const value = String(rawValue).trim()
    if (!value) continue
    params.set(key, value)
  }

  const queryString = params.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}

function interleaveByDomain(items: CopilotSuggestion[]): CopilotSuggestion[] {
  const notas = items.filter((item) => item.dominio === 'notas')
  const ordens = items.filter((item) => item.dominio === 'ordens')

  if (notas.length === 0 || ordens.length === 0) return items

  const result: CopilotSuggestion[] = []
  let notasIndex = 0
  let ordensIndex = 0
  let nextDomain: CopilotSuggestionDomain = items[0]?.dominio ?? 'notas'

  while (notasIndex < notas.length || ordensIndex < ordens.length) {
    if (nextDomain === 'notas') {
      if (notasIndex < notas.length) {
        result.push(notas[notasIndex])
        notasIndex += 1
      } else if (ordensIndex < ordens.length) {
        result.push(ordens[ordensIndex])
        ordensIndex += 1
      }
      nextDomain = 'ordens'
      continue
    }

    if (ordensIndex < ordens.length) {
      result.push(ordens[ordensIndex])
      ordensIndex += 1
    } else if (notasIndex < notas.length) {
      result.push(notas[notasIndex])
      notasIndex += 1
    }
    nextDomain = 'notas'
  }

  return result
}

/**
 * Generate actionable suggestions based on current operational state.
 *
 * Rules:
 * 1. Redistribuir: Admin sobrecarregado + outro com menor carga (anti-conflito de destinos)
 * 2. Escalar: Admins com critical_density >= 20% e >= 2 notas críticas (5+ dias)
 * 3. Férias: Admin em férias com notas abertas
 * 4. Pausar distribuição: Admin com workload_pressure >= 90%
 * 5. Investigar colaborador: order_severity >= 25%
 * 6. Investigar unidade: Unidade com muitas ordens vermelhas
 * 7. Distribuir sem atribuir
 */
export function buildSuggestions(params: {
  radarRows: WorkloadRadarRow[]
  isoAdmins: IsoAdminRow[]
  notasSemAtribuir: number
  ordensVermelhasPorUnidade?: Map<string, number>
  notasPanel?: NotaPanelData[]
  adminNoteStats?: ReadonlyMap<string, CopilotAdminNoteStats>
}): CopilotSuggestion[] {
  const {
    radarRows,
    isoAdmins,
    notasSemAtribuir,
    ordensVermelhasPorUnidade,
    notasPanel = [],
    adminNoteStats,
  } = params
  const suggestions: CopilotSuggestion[] = []
  nextId = 0

  // Índice de notas por admin para sampling eficiente
  const notasPorAdmin = new Map<string, NotaPanelData[]>()
  for (const nota of notasPanel) {
    if (!nota.administrador_id) continue
    const list = notasPorAdmin.get(nota.administrador_id) ?? []
    list.push(nota)
    notasPorAdmin.set(nota.administrador_id, list)
  }

  const now = new Date()
  const noteStatsByAdmin = adminNoteStats ?? buildAdminNoteStats(notasPanel, now)

  function getOpenNotesCount(adminId: string, fallback: number): number {
    return noteStatsByAdmin.get(adminId)?.qtd_abertas ?? fallback
  }

  function getCriticalNotesCount(adminId: string, fallback: number): number {
    return noteStatsByAdmin.get(adminId)?.qtd_notas_criticas ?? fallback
  }

  function getCriticalDensity(adminId: string, fallback: number): number {
    return noteStatsByAdmin.get(adminId)?.critical_density ?? fallback
  }

  // Helper: amostrar notas críticas (5+ dias)
  function sampleCriticalNotas(adminId: string, maxSamples = 3): NotaSample[] {
    const notas = notasPorAdmin.get(adminId) ?? []
    return notas
      .filter(n => isOpenStatus(n.status) && getSmartAgingCategory(n, now) === 'critico')
      .slice(0, maxSamples)
      .map(n => ({
        id: n.id,
        numero_nota: n.numero_nota ?? '',
        descricao: n.descricao ?? '',
        prioridade: n.prioridade,
        centro: n.centro,
      }))
  }

  const ociosos = radarRows.filter(
    (r) => r.workload_status === 'ocioso' && !r.em_ferias && r.recebe_distribuicao
  )
  const equilibrados = radarRows.filter(
    (r) => r.workload_status === 'equilibrado' && !r.em_ferias && r.recebe_distribuicao
  )
  const sobrecarregados = radarRows.filter(
    (r) => r.workload_status === 'sobrecarregado' && !r.em_ferias
  )

  // 1. Redistribuir de sobrecarregados para ociosos (anti-conflito: 1 destino por rodada)
  const destinosUsados = new Set<string>()
  for (const sobre of sobrecarregados) {
    const candidatos = [...ociosos, ...equilibrados]
      .filter((c) => c.administrador_id !== sobre.administrador_id && !destinosUsados.has(c.administrador_id))
      .sort((a, b) => (
        getOpenNotesCount(a.administrador_id, a.qtd_abertas)
        - getOpenNotesCount(b.administrador_id, b.qtd_abertas)
      ))
    const melhorDestino = candidatos[0]
    if (!melhorDestino) break

    const qtdAbertasSobre = getOpenNotesCount(sobre.administrador_id, sobre.qtd_abertas)
    const qtdAbertasDestino = getOpenNotesCount(melhorDestino.administrador_id, melhorDestino.qtd_abertas)
    if (qtdAbertasSobre <= 0) continue

    const diferencaCarga = Math.max(qtdAbertasSobre - qtdAbertasDestino, 0)
    const notasParaTransferir = Math.max(
      1,
      Math.min(
        Math.ceil(qtdAbertasSobre * 0.25),
        Math.ceil(diferencaCarga / 2)
      )
    )

    if (notasParaTransferir > 0) {
      destinosUsados.add(melhorDestino.administrador_id)
      suggestions.push({
        id: uid(),
        prioridade: 'alta',
        acao: 'redistribuir',
        dominio: 'notas',
        viewHref: buildHref('/', {
          status: 'abertas',
          responsavel: sobre.administrador_id,
        }),
        titulo: `Redistribuir notas de ${sobre.nome}`,
        descricao: `Transferir ~${notasParaTransferir} nota(s) de ${sobre.nome} (${qtdAbertasSobre} no painel, ${sobre.pct_carga.toFixed(0)}% carga) para ${melhorDestino.nome} (${qtdAbertasDestino} no painel).`,
        impacto: `Reduz ISO de ${sobre.nome} e equilibra carga da equipe.`,
        porQueAgora: `Carga ${sobre.pct_carga.toFixed(0)}% — acima da capacidade máxima.`,
        adminId: sobre.administrador_id,
        adminNome: sobre.nome,
        targetAdminId: melhorDestino.administrador_id,
        targetAdminNome: melhorDestino.nome,
      })
    }
  }

  // 2. Escalar notas com aging crítico — ordenado por iso_score desc (mais urgente primeiro)
  const isoMap = new Map(isoAdmins.map(a => [a.administrador_id, a]))
  const adminsPorScore = [...isoAdmins]
    .filter((a) => getCriticalNotesCount(a.administrador_id, a.qtd_notas_criticas) >= 2)
    .filter((a) => getCriticalDensity(a.administrador_id, a.critical_density) >= 20)
    .sort((a, b) => b.iso_score - a.iso_score)

  for (const admin of adminsPorScore) {
    const sample = sampleCriticalNotas(admin.administrador_id)
    const centros = [...new Set(sample.map(n => n.centro).filter(Boolean))] as string[]
    const qtdCriticas = getCriticalNotesCount(admin.administrador_id, admin.qtd_notas_criticas)
    const criticalDensity = getCriticalDensity(admin.administrador_id, admin.critical_density)
    suggestions.push({
      id: uid(),
      prioridade: 'alta',
      acao: 'escalar',
      dominio: 'notas',
      viewHref: buildHref('/', {
        status: 'abertas',
        kpi: 'dois_mais',
        responsavel: admin.administrador_id,
      }),
      titulo: `Escalar notas críticas de ${admin.nome}`,
      descricao: `${admin.nome} tem ${qtdCriticas} nota(s) com 5+ dias sem resolução (${criticalDensity.toFixed(0)}% do backlog).`,
      impacto: 'Reduz risco de SLA estourado e melhora tempo de resposta.',
      porQueAgora: `${qtdCriticas} nota(s) com 5+ dias${centros.length ? ` — ${centros.join(', ')}` : ''}.`,
      quemImpacta: centros.length ? `Área(s): ${centros.join(', ')}` : undefined,
      notasSample: sample,
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 3. Admin em férias com notas
  const emFerias = radarRows.filter(
    (r) => r.em_ferias && getOpenNotesCount(r.administrador_id, r.qtd_abertas) > 0
  )
  for (const admin of emFerias) {
    const qtdAbertas = getOpenNotesCount(admin.administrador_id, admin.qtd_abertas)
    suggestions.push({
      id: uid(),
      prioridade: 'alta',
      acao: 'redistribuir_ferias',
      dominio: 'notas',
      viewHref: buildHref('/', {
        status: 'abertas',
        responsavel: admin.administrador_id,
      }),
      titulo: `Redistribuir notas de ${admin.nome} (férias)`,
      descricao: `${admin.nome} está em férias com ${qtdAbertas} nota(s) aberta(s) no painel.`,
      impacto: 'Evita que notas envelhecam durante ausência.',
      porQueAgora: 'Admin em férias — notas sem responsável ativo.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 4. Pausar distribuição para admins com workload_pressure >= 90%
  // Não gerar se já tem sugestão de redistribuição DE saída para esse admin
  const sobrecarregadosIds = new Set(sobrecarregados.map(s => s.administrador_id))
  const cargaElevada = radarRows.filter(
    (r) =>
      !r.em_ferias &&
      r.recebe_distribuicao &&
      r.pct_carga >= 90 &&
      getOpenNotesCount(r.administrador_id, r.qtd_abertas) > 0 &&
      !sobrecarregadosIds.has(r.administrador_id)
  )
  for (const admin of cargaElevada) {
    const qtdAbertas = getOpenNotesCount(admin.administrador_id, admin.qtd_abertas)
    suggestions.push({
      id: uid(),
      prioridade: 'media',
      acao: 'pausar_distribuicao',
      dominio: 'notas',
      viewHref: buildHref('/', {
        status: 'abertas',
        responsavel: admin.administrador_id,
      }),
      titulo: `Pausar distribuição para ${admin.nome}`,
      descricao: `${admin.nome} está com carga ${admin.pct_carga.toFixed(0)}% (${qtdAbertas} nota(s) no painel).`,
      impacto: 'Evita sobrecarga e permite foco na resolução do backlog.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 5. Investigar colaboradores com order_severity >= 25%
  for (const admin of radarRows) {
    if (admin.em_ferias) continue
    const isoRow = isoMap.get(admin.administrador_id)
    if (!isoRow || isoRow.order_severity < 25) continue
    suggestions.push({
      id: uid(),
      prioridade: isoRow.order_severity >= 50 ? 'alta' : 'media',
      acao: 'investigar_colaborador_ordens',
      dominio: 'ordens',
      viewHref: buildHref('/ordens', {
        periodMode: 'all',
        prioridade: 'vermelho',
        responsavel: admin.administrador_id,
      }),
      titulo: `Investigar ordens atrasadas de ${admin.nome}`,
      descricao: `${admin.nome} concentra ${admin.qtd_ordens_vermelhas} ordem(ns) em semáforo vermelho (${isoRow.order_severity.toFixed(0)}% do total).`,
      impacto: 'Ajuda a reduzir ordens atrasadas e risco operacional.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 6. Investigar unidades com gargalo
  if (ordensVermelhasPorUnidade) {
    for (const [unidade, qtd] of ordensVermelhasPorUnidade) {
      if (qtd >= 5) {
        suggestions.push({
          id: uid(),
          prioridade: qtd >= 10 ? 'alta' : 'media',
          acao: 'investigar_unidade',
          dominio: 'ordens',
          viewHref: buildHref('/ordens', {
            periodMode: 'all',
            prioridade: 'vermelho',
            unidade,
          }),
          titulo: `Investigar gargalo na unidade ${unidade}`,
          descricao: `Unidade ${unidade} tem ${qtd} ordem(ns) com semáforo vermelho (7+ dias).`,
          impacto: 'Identifica problemas sistematicos na unidade.',
          unidade,
        })
      }
    }
  }

  // 7. Notas sem atribuir (lembrete)
  if (notasSemAtribuir > 0 && ociosos.length > 0) {
    suggestions.push({
      id: uid(),
      prioridade: 'media',
      acao: 'redistribuir',
      dominio: 'notas',
      viewHref: buildHref('/', {
        status: 'nova',
        responsavel: 'sem_atribuir',
      }),
      titulo: 'Distribuir notas sem responsável',
      descricao: `${notasSemAtribuir} nota(s) sem atribuir. ${ociosos.length} colaborador(es) disponivel(eis).`,
      impacto: 'Reduz backlog sem atribuição.',
    })
  }

  const byPriority: Record<SuggestionPriority, CopilotSuggestion[]> = {
    alta: [],
    media: [],
    baixa: [],
  }

  for (const suggestion of suggestions) {
    byPriority[suggestion.prioridade].push(suggestion)
  }

  return (['alta', 'media', 'baixa'] as SuggestionPriority[])
    .flatMap((priority) => interleaveByDomain(byPriority[priority]))
}
