import { describe, it, expect } from 'vitest'
import {
  filterCarteiraRowsByTipo,
  filterCarteiraRowsByAdmin,
  deriveAvailableAdmins,
  deriveCarteiraFilterAdmins,
  buildCarteiraKpis,
  isValidCarteiraTipo,
  CARTEIRA_EMPTY_MESSAGES,
} from './carteira-helpers'
import type { PedidosCarteiraFornecedorRow } from '@/lib/types/pedidos'

function makeRow(overrides: Partial<PedidosCarteiraFornecedorRow>): PedidosCarteiraFornecedorRow {
  return {
    fornecedorCodigo: '10079',
    fornecedorNome: 'NDS',
    tipoCarteira: 'corretiva',
    adminId: 'admin-1',
    adminNome: 'Paula Matos',
    adminAvatar: null,
    qtdPedidos: 10,
    emAberto: 2,
    encerrado: 7,
    cancelado: 1,
    valorTotal: 1000,
    documentosCompras: [],
    pedidosContratos: [],
    ...overrides,
  }
}

describe('filterCarteiraRowsByTipo', () => {
  it('returns only rows matching the given tipo', () => {
    const rows = [
      makeRow({ fornecedorCodigo: '1', tipoCarteira: 'corretiva' }),
      makeRow({ fornecedorCodigo: '2', tipoCarteira: 'preventiva_anual' }),
      makeRow({ fornecedorCodigo: '3', tipoCarteira: 'corretiva' }),
    ]
    const result = filterCarteiraRowsByTipo(rows, 'corretiva')
    expect(result.map((r) => r.fornecedorCodigo)).toEqual(['1', '3'])
  })

  it('returns an empty array when nothing matches', () => {
    const rows = [makeRow({ tipoCarteira: 'corretiva' })]
    expect(filterCarteiraRowsByTipo(rows, 'preventiva_anual')).toEqual([])
  })
})

describe('deriveAvailableAdmins', () => {
  it('returns unique admins sorted by nome (pt-BR)', () => {
    const rows = [
      makeRow({ adminId: 'a2', adminNome: 'Wanderlucio Mendes' }),
      makeRow({ adminId: 'a1', adminNome: 'Ana Paula' }),
      makeRow({ adminId: 'a2', adminNome: 'Wanderlucio Mendes' }),
    ]
    const result = deriveAvailableAdmins(rows)
    expect(result).toEqual([
      { id: 'a1', nome: 'Ana Paula', avatarUrl: null },
      { id: 'a2', nome: 'Wanderlucio Mendes', avatarUrl: null },
    ])
  })

  it('returns an empty array for no rows', () => {
    expect(deriveAvailableAdmins([])).toEqual([])
  })
})

describe('preventiva anual admin filter', () => {
  const rows = [
    makeRow({
      fornecedorCodigo: '9542',
      tipoCarteira: 'preventiva_anual',
      adminId: 'fabiola',
      adminNome: 'Fabíola Tentunge',
      pedidosContratos: [
        { numero: '45001', ciclo: 'MENSAL', admin_id: 'fabiola', admin_nome: 'Fabíola Tentunge', admin_avatar: null },
        { numero: '45002', ciclo: 'TRIMESTRAL', admin_id: 'suelem', admin_nome: 'Suelém Silva', admin_avatar: null },
      ],
    }),
  ]

  it('derives filter options from the responsible admin shown on each contract', () => {
    expect(deriveCarteiraFilterAdmins(rows, 'preventiva_anual')).toEqual([
      { id: 'fabiola', nome: 'Fabíola Tentunge' },
      { id: 'suelem', nome: 'Suelém Silva' },
    ])
  })

  it('keeps only contracts owned by the selected admin', () => {
    const result = filterCarteiraRowsByAdmin(rows, 'preventiva_anual', 'fabiola')

    expect(result).toHaveLength(1)
    expect(result[0].pedidosContratos).toEqual([
      { numero: '45001', ciclo: 'MENSAL', admin_id: 'fabiola', admin_nome: 'Fabíola Tentunge', admin_avatar: null },
    ])
  })
})

describe('buildCarteiraKpis', () => {
  it('sums totals across rows', () => {
    const rows = [
      makeRow({ qtdPedidos: 10, emAberto: 2, encerrado: 7, cancelado: 1, valorTotal: 1000 }),
      makeRow({ qtdPedidos: 5, emAberto: 1, encerrado: 3, cancelado: 1, valorTotal: 500 }),
    ]
    expect(buildCarteiraKpis(rows)).toEqual({
      totalFornecedores: 2,
      totalPedidos: 15,
      emAberto: 3,
      encerrado: 10,
      cancelado: 2,
      valorTotal: 1500,
    })
  })

  it('returns zeroed totals for an empty array', () => {
    expect(buildCarteiraKpis([])).toEqual({
      totalFornecedores: 0,
      totalPedidos: 0,
      emAberto: 0,
      encerrado: 0,
      cancelado: 0,
      valorTotal: 0,
    })
  })
})

describe('isValidCarteiraTipo', () => {
  it('accepts valid values', () => {
    expect(isValidCarteiraTipo('corretiva')).toBe(true)
    expect(isValidCarteiraTipo('preventiva_anual')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isValidCarteiraTipo('outros')).toBe(false)
    expect(isValidCarteiraTipo(null)).toBe(false)
    expect(isValidCarteiraTipo(undefined)).toBe(false)
  })
})

describe('CARTEIRA_EMPTY_MESSAGES', () => {
  it('has a message per tipo', () => {
    expect(CARTEIRA_EMPTY_MESSAGES.corretiva).toBe('Nenhum fornecedor mapeado na carteira de corretivas.')
    expect(CARTEIRA_EMPTY_MESSAGES.preventiva_anual).toBe('Nenhum fornecedor mapeado na carteira de preventivas anuais.')
  })
})
