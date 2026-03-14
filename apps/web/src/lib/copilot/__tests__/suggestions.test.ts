import { describe, expect, it } from 'vitest'
import { buildSuggestions } from '@/lib/copilot/suggestions'
import type { WorkloadRadarRow, IsoAdminRow } from '@/lib/types/copilot'
import type { NotaPanelData } from '@/lib/types/database'

function makeRadar(overrides: Partial<WorkloadRadarRow> = {}): WorkloadRadarRow {
  return {
    administrador_id: 'a1',
    nome: 'Admin',
    avatar_url: null,
    especialidade: null,
    iso_score: 20,
    iso_faixa: 'atencao',
    qtd_abertas: 10,
    max_notas: 20,
    pct_carga: 50,
    workload_status: 'equilibrado',
    qtd_notas_criticas: 0,
    qtd_ordens_vermelhas: 0,
    concluidas_7d: 5,
    concluidas_30d: 20,
    media_diaria_30d: 0.67,
    em_ferias: false,
    recebe_distribuicao: true,
    ...overrides,
  }
}

function makeIso(overrides: Partial<IsoAdminRow> = {}): IsoAdminRow {
  return {
    administrador_id: 'a1',
    nome: 'Admin',
    avatar_url: null,
    especialidade: null,
    nota_severity: 10,
    order_severity: 0,
    workload_pressure: 50,
    critical_density: 0,
    iso_score: 20,
    iso_faixa: 'atencao',
    qtd_abertas: 10,
    max_notas: 20,
    qtd_notas_criticas: 0,
    qtd_ordens_vermelhas: 0,
    ...overrides,
  }
}

function makeNota(overrides: Partial<NotaPanelData> = {}): NotaPanelData {
  const createdAt = new Date()
  createdAt.setDate(createdAt.getDate() - 6)
  return {
    id: 'n1',
    numero_nota: '12345',
    descricao: 'Nota de teste',
    status: 'em_andamento',
    administrador_id: 'a1',
    prioridade: 'normal',
    centro: 'MAINT',
    data_criacao_sap: null,
    created_at: createdAt.toISOString(),
    ...overrides,
  } as NotaPanelData
}

describe('buildSuggestions', () => {
  it('retorna vazio quando não há dados críticos', () => {
    const result = buildSuggestions({
      radarRows: [makeRadar()],
      isoAdmins: [makeIso()],
      notasSemAtribuir: 0,
    })
    expect(result).toHaveLength(0)
  })

  describe('Regra 1 — redistribuir sobrecarregado', () => {
    it('gera sugestão de redistribuição quando há sobrecarregado + ocioso', () => {
      const sobre = makeRadar({ administrador_id: 'a1', nome: 'Sobre', workload_status: 'sobrecarregado', qtd_abertas: 20, pct_carga: 110 })
      const ocioso = makeRadar({ administrador_id: 'a2', nome: 'Ocioso', workload_status: 'ocioso', qtd_abertas: 2, pct_carga: 10 })
      const result = buildSuggestions({ radarRows: [sobre, ocioso], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'redistribuir' && s.adminId === 'a1')).toBe(true)
    })

    it('não gera redistribuição se sobrecarregado em férias', () => {
      const sobre = makeRadar({ workload_status: 'sobrecarregado', em_ferias: true, qtd_abertas: 20, pct_carga: 110 })
      const ocioso = makeRadar({ administrador_id: 'a2', workload_status: 'ocioso', qtd_abertas: 2, pct_carga: 10 })
      const result = buildSuggestions({ radarRows: [sobre, ocioso], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'redistribuir' && s.adminId === 'a1')).toBe(false)
    })

    it('anti-conflito: mesmo destino não é usado duas vezes', () => {
      const sobre1 = makeRadar({ administrador_id: 'a1', nome: 'S1', workload_status: 'sobrecarregado', qtd_abertas: 20, pct_carga: 110 })
      const sobre2 = makeRadar({ administrador_id: 'a2', nome: 'S2', workload_status: 'sobrecarregado', qtd_abertas: 22, pct_carga: 115 })
      const ocioso = makeRadar({ administrador_id: 'a3', nome: 'Ocioso', workload_status: 'ocioso', qtd_abertas: 2, pct_carga: 10 })
      const result = buildSuggestions({ radarRows: [sobre1, sobre2, ocioso], isoAdmins: [], notasSemAtribuir: 0 })
      const redistribuir = result.filter(s => s.acao === 'redistribuir' && (s.adminId === 'a1' || s.adminId === 'a2'))
      // Apenas uma das sugestões pode ter a3 como destino
      const destA3 = redistribuir.filter(s => s.targetAdminId === 'a3')
      expect(destA3.length).toBeLessThanOrEqual(1)
    })

    it('sugestão tem targetAdminId e targetAdminNome', () => {
      const sobre = makeRadar({ administrador_id: 'a1', nome: 'Sobre', workload_status: 'sobrecarregado', qtd_abertas: 20, pct_carga: 110 })
      const ocioso = makeRadar({ administrador_id: 'a2', nome: 'Ocioso', workload_status: 'ocioso', qtd_abertas: 2, pct_carga: 10 })
      const result = buildSuggestions({ radarRows: [sobre, ocioso], isoAdmins: [], notasSemAtribuir: 0 })
      const sug = result.find(s => s.acao === 'redistribuir')
      expect(sug?.targetAdminId).toBe('a2')
      expect(sug?.targetAdminNome).toBe('Ocioso')
    })

    it('viewHref contém responsavel do sobrecarregado', () => {
      const sobre = makeRadar({ administrador_id: 'a1', workload_status: 'sobrecarregado', qtd_abertas: 20, pct_carga: 110 })
      const ocioso = makeRadar({ administrador_id: 'a2', workload_status: 'ocioso', qtd_abertas: 2, pct_carga: 10 })
      const result = buildSuggestions({ radarRows: [sobre, ocioso], isoAdmins: [], notasSemAtribuir: 0 })
      const sug = result.find(s => s.acao === 'redistribuir')
      expect(sug?.viewHref).toContain('a1')
    })
  })

  describe('Regra 2 — escalar críticos', () => {
    it('gera sugestão de escalar quando critical_density >= 20 e qtd_notas_criticas >= 2', () => {
      const iso = makeIso({ administrador_id: 'a1', nome: 'Admin', critical_density: 25, qtd_notas_criticas: 3, iso_score: 60 })
      const result = buildSuggestions({ radarRows: [], isoAdmins: [iso], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'escalar' && s.adminId === 'a1')).toBe(true)
    })

    it('não gera escalar quando critical_density < 20', () => {
      const iso = makeIso({ critical_density: 15, qtd_notas_criticas: 3 })
      const result = buildSuggestions({ radarRows: [], isoAdmins: [iso], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'escalar')).toBe(false)
    })

    it('não gera escalar quando qtd_notas_criticas < 2', () => {
      const iso = makeIso({ critical_density: 30, qtd_notas_criticas: 1 })
      const result = buildSuggestions({ radarRows: [], isoAdmins: [iso], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'escalar')).toBe(false)
    })

    it('inclui notasSample quando notasPanel fornecido com notas críticas', () => {
      const iso = makeIso({ administrador_id: 'a1', critical_density: 25, qtd_notas_criticas: 3, iso_score: 60 })
      const nota = makeNota({ administrador_id: 'a1' })
      const result = buildSuggestions({ radarRows: [], isoAdmins: [iso], notasSemAtribuir: 0, notasPanel: [nota] })
      const sug = result.find(s => s.acao === 'escalar')
      expect(sug?.notasSample?.length).toBeGreaterThan(0)
    })

    it('ordena por iso_score desc (mais urgente primeiro)', () => {
      const iso1 = makeIso({ administrador_id: 'a1', nome: 'Baixo', critical_density: 25, qtd_notas_criticas: 2, iso_score: 40 })
      const iso2 = makeIso({ administrador_id: 'a2', nome: 'Alto', critical_density: 30, qtd_notas_criticas: 3, iso_score: 80 })
      const result = buildSuggestions({ radarRows: [], isoAdmins: [iso1, iso2], notasSemAtribuir: 0 })
      const escalar = result.filter(s => s.acao === 'escalar')
      expect(escalar[0].adminId).toBe('a2')
    })

    it('usa a contagem real do notasPanel quando o agregado vier inflado', () => {
      const iso = makeIso({
        administrador_id: 'a1',
        nome: 'Admin',
        qtd_abertas: 57,
        qtd_notas_criticas: 50,
        critical_density: 87.7,
        iso_score: 60,
      })
      const notas = [
        ...Array.from({ length: 14 }, (_, index) => makeNota({ id: `crit-${index}`, numero_nota: `10${index}`, administrador_id: 'a1' })),
        ...Array.from({ length: 4 }, (_, index) => {
          const createdAt = new Date()
          createdAt.setDate(createdAt.getDate() - 1)
          return makeNota({
            id: `ok-${index}`,
            numero_nota: `20${index}`,
            administrador_id: 'a1',
            created_at: createdAt.toISOString(),
          })
        }),
      ]

      const result = buildSuggestions({ radarRows: [], isoAdmins: [iso], notasSemAtribuir: 0, notasPanel: notas })
      const sug = result.find(s => s.acao === 'escalar')
      expect(sug?.descricao).toContain('14 nota(s)')
      expect(sug?.descricao).toContain('(78% do backlog)')
    })
  })

  describe('Regra 3 — férias com notas abertas', () => {
    it('gera sugestão redistribuir_ferias quando admin em férias tem notas', () => {
      const admin = makeRadar({ em_ferias: true, qtd_abertas: 5 })
      const result = buildSuggestions({ radarRows: [admin], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'redistribuir_ferias')).toBe(true)
    })

    it('não gera redistribuir_ferias quando admin em férias sem notas', () => {
      const admin = makeRadar({ em_ferias: true, qtd_abertas: 0 })
      const result = buildSuggestions({ radarRows: [admin], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'redistribuir_ferias')).toBe(false)
    })
  })

  describe('Regra 4 — pausar distribuição', () => {
    it('gera pausar_distribuicao quando pct_carga >= 90 e não sobrecarregado', () => {
      const admin = makeRadar({ workload_status: 'carregado', pct_carga: 92, qtd_abertas: 18, recebe_distribuicao: true })
      const result = buildSuggestions({ radarRows: [admin], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'pausar_distribuicao')).toBe(true)
    })

    it('não gera pausar quando admin é sobrecarregado (evita conflito)', () => {
      const admin = makeRadar({ workload_status: 'sobrecarregado', pct_carga: 115 })
      const result = buildSuggestions({ radarRows: [admin], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'pausar_distribuicao')).toBe(false)
    })

    it('não gera pausar quando pct_carga < 90', () => {
      const admin = makeRadar({ pct_carga: 85 })
      const result = buildSuggestions({ radarRows: [admin], isoAdmins: [], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'pausar_distribuicao')).toBe(false)
    })
  })

  describe('Regra 5 — investigar colaborador ordens', () => {
    it('gera investigar_colaborador_ordens quando order_severity >= 25', () => {
      const radar = makeRadar({ administrador_id: 'a1' })
      const iso = makeIso({ administrador_id: 'a1', order_severity: 30 })
      const result = buildSuggestions({ radarRows: [radar], isoAdmins: [iso], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'investigar_colaborador_ordens')).toBe(true)
    })

    it('prioridade alta quando order_severity >= 50', () => {
      const radar = makeRadar({ administrador_id: 'a1' })
      const iso = makeIso({ administrador_id: 'a1', order_severity: 55 })
      const result = buildSuggestions({ radarRows: [radar], isoAdmins: [iso], notasSemAtribuir: 0 })
      const sug = result.find(s => s.acao === 'investigar_colaborador_ordens')
      expect(sug?.prioridade).toBe('alta')
    })

    it('não gera investigar quando order_severity < 25', () => {
      const radar = makeRadar({ administrador_id: 'a1' })
      const iso = makeIso({ administrador_id: 'a1', order_severity: 20 })
      const result = buildSuggestions({ radarRows: [radar], isoAdmins: [iso], notasSemAtribuir: 0 })
      expect(result.some(s => s.acao === 'investigar_colaborador_ordens')).toBe(false)
    })
  })

  describe('Regra 6 — investigar unidade', () => {
    it('gera investigar_unidade quando qtd >= 5', () => {
      const map = new Map([['UNIT-01', 7]])
      const result = buildSuggestions({ radarRows: [], isoAdmins: [], notasSemAtribuir: 0, ordensVermelhasPorUnidade: map })
      expect(result.some(s => s.acao === 'investigar_unidade' && s.unidade === 'UNIT-01')).toBe(true)
    })

    it('não gera investigar_unidade quando qtd < 5', () => {
      const map = new Map([['UNIT-01', 4]])
      const result = buildSuggestions({ radarRows: [], isoAdmins: [], notasSemAtribuir: 0, ordensVermelhasPorUnidade: map })
      expect(result.some(s => s.acao === 'investigar_unidade')).toBe(false)
    })

    it('prioridade alta quando qtd >= 10', () => {
      const map = new Map([['UNIT-01', 12]])
      const result = buildSuggestions({ radarRows: [], isoAdmins: [], notasSemAtribuir: 0, ordensVermelhasPorUnidade: map })
      const sug = result.find(s => s.acao === 'investigar_unidade')
      expect(sug?.prioridade).toBe('alta')
    })
  })

  describe('Regra 7 — distribuir sem atribuir', () => {
    it('gera redistribuir quando há notas sem atribuir e ociosos', () => {
      const ocioso = makeRadar({ workload_status: 'ocioso', pct_carga: 10, recebe_distribuicao: true })
      const result = buildSuggestions({ radarRows: [ocioso], isoAdmins: [], notasSemAtribuir: 5 })
      const sug = result.find(s => s.acao === 'redistribuir' && s.viewHref?.includes('sem_atribuir'))
      expect(sug).toBeDefined()
    })

    it('não gera sem-atribuir quando não há ociosos', () => {
      const result = buildSuggestions({ radarRows: [], isoAdmins: [], notasSemAtribuir: 5 })
      expect(result.some(s => s.viewHref?.includes('sem_atribuir'))).toBe(false)
    })
  })

  describe('Ordenação e domínio', () => {
    it('sugestões alta vêm antes de média', () => {
      const iso = makeIso({ administrador_id: 'a1', critical_density: 25, qtd_notas_criticas: 3, iso_score: 60 })
      const radar = makeRadar({ administrador_id: 'a1', workload_status: 'carregado', pct_carga: 92 })
      const result = buildSuggestions({ radarRows: [radar], isoAdmins: [iso], notasSemAtribuir: 0 })
      const firstMedia = result.findIndex(s => s.prioridade === 'media')
      const lastAlta = result.map(s => s.prioridade).lastIndexOf('alta')
      if (firstMedia !== -1 && lastAlta !== -1) {
        expect(lastAlta).toBeLessThan(firstMedia)
      }
    })

    it('todos os ids são únicos', () => {
      const sobre = makeRadar({ administrador_id: 'a1', workload_status: 'sobrecarregado', qtd_abertas: 20, pct_carga: 110 })
      const ocioso = makeRadar({ administrador_id: 'a2', workload_status: 'ocioso', qtd_abertas: 2, pct_carga: 10 })
      const iso = makeIso({ administrador_id: 'a1', order_severity: 30 })
      const result = buildSuggestions({ radarRows: [sobre, ocioso], isoAdmins: [iso], notasSemAtribuir: 3 })
      const ids = result.map(s => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})
