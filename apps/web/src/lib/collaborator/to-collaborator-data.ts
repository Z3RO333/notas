import { buildAgingCounts } from '@/lib/collaborator/metrics'
import { resolveAvatarUrl } from '@/lib/collaborator/avatar-presentation'
import type { CargaAdministrador, NotaPanelData } from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

interface ToCollaboratorDataOptions {
  qtdAcompanhamentoOrdens?: number
}

export function toCollaboratorData(
  carga: CargaAdministrador,
  notas: NotaPanelData[],
  options: ToCollaboratorDataOptions = {}
): CollaboratorData {
  const adminNotas = notas.filter((nota) => nota.administrador_id === carga.id)
  const aging = buildAgingCounts(adminNotas)

  return {
    id: carga.id,
    nome: carga.nome,
    ativo: carga.ativo,
    max_notas: carga.max_notas,
    avatar_url: resolveAvatarUrl({ name: carga.nome, avatarUrl: carga.avatar_url }),
    especialidade: carga.especialidade,
    recebe_distribuicao: carga.recebe_distribuicao,
    em_ferias: carga.em_ferias,
    qtd_nova: carga.qtd_nova,
    qtd_em_andamento: carga.qtd_em_andamento,
    qtd_encaminhada: carga.qtd_encaminhada,
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: carga.qtd_abertas,
    qtd_concluidas: carga.qtd_concluidas,
    qtd_acompanhamento_ordens: options.qtdAcompanhamentoOrdens ?? (carga.qtd_ordens_ativas ?? 0),
  }
}
