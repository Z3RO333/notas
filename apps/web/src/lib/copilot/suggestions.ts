import type {
  CopilotSuggestion,
  WorkloadRadarRow,
  IsoAdminRow,
} from '@/lib/types/copilot'

let nextId = 0
function uid(): string {
  nextId += 1
  return `sug-${nextId}`
}

/**
 * Generate actionable suggestions based on current operational state.
 *
 * Rules:
 * 1. Redistribuir: Admin sobrecarregado + outro com menor carga
 * 2. Escalar: Notas criticas (5+d) sem acao
 * 3. Ferias: Admin em ferias com notas abertas
 * 4. Pausar distribuicao: Admin com carga persistente elevada
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

  // 2. Escalar notas com aging critico
  for (const admin of isoAdmins) {
    if (admin.qtd_notas_criticas >= 3) {
      suggestions.push({
        id: uid(),
        prioridade: 'alta',
        acao: 'escalar',
        titulo: `Escalar notas criticas de ${admin.nome}`,
        descricao: `${admin.nome} tem ${admin.qtd_notas_criticas} nota(s) com 3+ dias sem resolucao.`,
        impacto: 'Reduz risco de SLA estourado e melhora tempo de resposta.',
        adminId: admin.administrador_id,
        adminNome: admin.nome,
      })
    }
  }

  // 3. Admin em ferias com notas
  const emFerias = radarRows.filter((r) => r.em_ferias && r.qtd_abertas > 0)
  for (const admin of emFerias) {
    suggestions.push({
      id: uid(),
      prioridade: 'alta',
      acao: 'redistribuir_ferias',
      titulo: `Redistribuir notas de ${admin.nome} (ferias)`,
      descricao: `${admin.nome} esta em ferias com ${admin.qtd_abertas} nota(s) aberta(s).`,
      impacto: 'Evita que notas envelhecam durante ausencia.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 4. Pausar distribuicao para admins com sobrecarga recorrente
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
      titulo: `Pausar distribuicao para ${admin.nome}`,
      descricao: `${admin.nome} esta com ${admin.qtd_abertas} nota(s) aberta(s) e carga elevada.`,
      impacto: 'Evita sobrecarga e permite foco na resolucao do backlog.',
      adminId: admin.administrador_id,
      adminNome: admin.nome,
    })
  }

  // 5. Investigar unidades com gargalo
  if (ordensVermelhasPorUnidade) {
    for (const [unidade, qtd] of ordensVermelhasPorUnidade) {
      if (qtd >= 5) {
        suggestions.push({
          id: uid(),
          prioridade: qtd >= 10 ? 'alta' : 'media',
          acao: 'investigar_unidade',
          titulo: `Investigar gargalo na unidade ${unidade}`,
          descricao: `Unidade ${unidade} tem ${qtd} orden(s) com semaforo vermelho (7+ dias).`,
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
      titulo: 'Distribuir notas sem responsavel',
      descricao: `${notasSemAtribuir} nota(s) sem atribuir. ${ociosos.length} colaborador(es) disponivel(eis).`,
      impacto: 'Reduz backlog sem atribuicao.',
    })
  }

  // Sort by priority
  const prioOrder = { alta: 0, media: 1, baixa: 2 }
  return suggestions.sort((a, b) => prioOrder[a.prioridade] - prioOrder[b.prioridade])
}
