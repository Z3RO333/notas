import type {
  CopilotSuggestion,
  CopilotSuggestionDomain,
  SuggestionPriority,
  WorkloadRadarRow,
  IsoAdminRow,
} from '@/lib/types/copilot'

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
 * 1. Redistribuir: Admin sobrecarregado + outro com menor carga
 * 2. Escalar: Notas críticas (5+d) sem ação
 * 3. Férias: Admin em férias com notas abertas
 * 4. Pausar distribuição: Admin com carga persistente elevada
 * 5. Investigar unidade: Unidade com muitas ordens vermelhas
 */
export function buildSuggestions(params: {
  radarRows: WorkloadRadarRow[]
  isoAdmins: IsoAdminRow[]
  notasSemAtribuir: number
  ordensVermelhasPorUnidade?: Map<string, number>
}): CopilotSuggestion[] {
  const { radarRows, isoAdmins, notasSemAtribuir, ordensVermelhasPorUnidade } = params
  const suggestions: CopilotSuggestion[] = []
  nextId = 0

  const ociosos = radarRows.filter(
    (r) => r.workload_status === 'ocioso' && !r.em_ferias && r.recebe_distribuicao
  )
  const equilibrados = radarRows.filter(
    (r) => r.workload_status === 'equilibrado' && !r.em_ferias && r.recebe_distribuicao
  )
  const sobrecarregados = radarRows.filter(
    (r) => r.workload_status === 'sobrecarregado' && !r.em_ferias
  )

  // 1. Redistribuir de sobrecarregados para ociosos
  for (const sobre of sobrecarregados) {
    const candidatos = [...ociosos, ...equilibrados]
      .filter((candidato) => candidato.administrador_id !== sobre.administrador_id)
      .sort((a, b) => a.qtd_abertas - b.qtd_abertas)
    const melhorDestino = candidatos[0]
    if (!melhorDestino) break

    const diferencaCarga = Math.max(sobre.qtd_abertas - melhorDestino.qtd_abertas, 0)
    const notasParaTransferir = Math.max(
      1,
      Math.min(
        Math.ceil(sobre.qtd_abertas * 0.25),
        Math.ceil(diferencaCarga / 2)
      )
    )

    if (notasParaTransferir > 0) {
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
        descricao: `Transferir ~${notasParaTransferir} nota(s) de ${sobre.nome} (${sobre.qtd_abertas} abertas) para ${melhorDestino.nome} (${melhorDestino.qtd_abertas} abertas).`,
        impacto: `Reduz ISO de ${sobre.nome} e equilibra carga da equipe.`,
        adminId: sobre.administrador_id,
        adminNome: sobre.nome,
        targetAdminId: melhorDestino.administrador_id,
        targetAdminNome: melhorDestino.nome,
      })
    }
  }

  // 2. Escalar notas com aging crítico
  for (const admin of isoAdmins) {
    if (admin.qtd_notas_criticas >= 3) {
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
        descricao: `${admin.nome} tem ${admin.qtd_notas_criticas} nota(s) com 3+ dias sem resolução.`,
        impacto: 'Reduz risco de SLA estourado e melhora tempo de resposta.',
        adminId: admin.administrador_id,
        adminNome: admin.nome,
      })
    }
  }

  // 3. Admin em férias com notas
  const emFerias = radarRows.filter((r) => r.em_ferias && r.qtd_abertas > 0)
  for (const admin of emFerias) {
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
      descricao: `${admin.nome} esta em férias com ${admin.qtd_abertas} nota(s) aberta(s).`,
      impacto: 'Evita que notas envelhecam durante ausência.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 4. Pausar distribuição para admins com sobrecarga recorrente
  const cargaElevada = radarRows.filter(
    (r) =>
      !r.em_ferias &&
      r.recebe_distribuicao &&
      (r.workload_status === 'sobrecarregado' || r.workload_status === 'carregado') &&
      r.qtd_abertas >= 15
  )
  for (const admin of cargaElevada) {
    if (sobrecarregados.some((s) => s.administrador_id === admin.administrador_id)) continue
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
      descricao: `${admin.nome} está com ${admin.qtd_abertas} nota(s) aberta(s) e carga elevada.`,
      impacto: 'Evita sobrecarga e permite foco na resolução do backlog.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 5. Investigar colaboradores com ordens atrasadas
  for (const admin of radarRows) {
    if (admin.em_ferias || admin.qtd_ordens_vermelhas < 3) continue
    suggestions.push({
      id: uid(),
      prioridade: admin.qtd_ordens_vermelhas >= 7 ? 'alta' : 'media',
      acao: 'investigar_colaborador_ordens',
      dominio: 'ordens',
      viewHref: buildHref('/ordens', {
        periodMode: 'all',
        prioridade: 'vermelho',
        responsavel: admin.administrador_id,
      }),
      titulo: `Investigar ordens atrasadas de ${admin.nome}`,
      descricao: `${admin.nome} concentra ${admin.qtd_ordens_vermelhas} ordem(ns) em semáforo vermelho.`,
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
          descricao: `Unidade ${unidade} tem ${qtd} orden(s) com semáforo vermelho (7+ dias).`,
          impacto: 'Identifica problemas sistematicos na unidade.',
          unidade,
        })
      }
    }
  }

  // 6. Notas sem atribuir (lembrete)
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
