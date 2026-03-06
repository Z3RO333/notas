import { describe, expect, it } from 'vitest'
import { recomputeWorkspaceKpisFromRows } from '@/lib/orders/workspace-kpis'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

function makeRow(
  ordemId: string,
  raw: string | null,
  semaforo: OrdemNotaAcompanhamento['semaforo_atraso'],
  responsavelAtualId: string | null,
  statusOrdem: OrdemNotaAcompanhamento['status_ordem'] = 'em_tratativa'
): OrdemNotaAcompanhamento {
  return {
    ordem_id: ordemId,
    nota_id: `${ordemId}-nota`,
    numero_nota: `${ordemId}-nota-num`,
    ordem_codigo: `${ordemId}-ordem`,
    administrador_id: null,
    administrador_nome: null,
    responsavel_atual_id: responsavelAtualId,
    responsavel_atual_nome: responsavelAtualId ? `Admin ${responsavelAtualId}` : null,
    centro: null,
    unidade: 'CD MANAUS',
    status_ordem: statusOrdem,
    status_ordem_raw: raw,
    ordem_detectada_em: '2026-03-01T00:00:00.000Z',
    status_atualizado_em: null,
    dias_para_gerar_ordem: null,
    qtd_historico: 0,
    tem_historico: false,
    dias_em_aberto: 5,
    semaforo_atraso: semaforo,
    envolvidos_admin_ids: null,
    descricao: null,
    tipo_ordem: 'PMOS',
  }
}

describe('workspace-kpis', () => {
  it('recomputes KPIs from RAW status buckets only', () => {
    const rows: OrdemNotaAcompanhamento[] = [
      makeRow('1', 'ABERTO', 'verde', 'admin-1', 'aberta'),
      makeRow('2', 'EM_PROCESSAMENTO', 'amarelo', null, 'em_tratativa'),
      makeRow('3', 'EM_EXECUCAO', 'vermelho', 'admin-2'),
      makeRow('4', 'AVALIACAO_DE_EXECUCAO', 'vermelho', 'admin-2'),
      makeRow('5', 'EXECUCAO_SATISFATORIA', 'vermelho', 'admin-2', 'concluida'),
      makeRow('6', 'CONCLUIDO', 'neutro', 'admin-2', 'concluida'),
      makeRow('7', 'CANCELADO', 'neutro', 'admin-2', 'cancelada'),
      makeRow('8', 'EXECUCAO_NAO_REALIZADA', 'vermelho', null),
      makeRow('9', null, 'vermelho', null, 'desconhecido'),
    ]

    const kpis = recomputeWorkspaceKpisFromRows(rows)

    expect(kpis.total).toBe(9)
    expect(kpis.abertas).toBe(2)
    expect(kpis.em_tratativa).toBe(1)
    expect(kpis.em_avaliacao).toBe(1)
    expect(kpis.concluidas).toBe(1)
    expect(kpis.canceladas).toBe(1)
    expect(kpis.avaliadas).toBe(1)
    expect(kpis.atrasadas).toBe(4)
    expect(kpis.sem_responsavel).toBe(3)
  })
})
