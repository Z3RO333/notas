import { describe, expect, it } from 'vitest'
import { mergeRows, resolveSmartSearch } from '@/components/orders/use-orders-data'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

function makeRow(id: string): OrdemNotaAcompanhamento {
  return { ordem_id: id } as OrdemNotaAcompanhamento
}

describe('mergeRows', () => {
  it('retorna incoming quando prev está vazio', () => {
    const result = mergeRows([], [makeRow('a'), makeRow('b')])
    expect(result.map((r) => r.ordem_id)).toEqual(['a', 'b'])
  })

  it('não duplica linhas já presentes', () => {
    const prev = [makeRow('a'), makeRow('b')]
    const incoming = [makeRow('b'), makeRow('c')]
    const result = mergeRows(prev, incoming)
    expect(result.map((r) => r.ordem_id)).toEqual(['a', 'b', 'c'])
  })

  it('retorna a mesma referência quando não há novas linhas', () => {
    const prev = [makeRow('a')]
    const result = mergeRows(prev, [makeRow('a')])
    expect(result).toBe(prev)
  })
})

describe('resolveSmartSearch', () => {
  const owners = [
    { id: 'u1', nome: 'Paula Matos' },
    { id: 'u2', nome: 'Wanderlucio Mendes' },
    { id: 'u3', nome: 'Carmen Silva' },
  ]

  it('modo none quando query vazia', () => {
    const r = resolveSmartSearch('', owners, 'todos', true)
    expect(r.mode).toBe('none')
    expect(r.effectiveQ).toBe('')
  })

  it('modo nota para sequência numérica curta', () => {
    const r = resolveSmartSearch('12345', owners, 'todos', true)
    expect(r.mode).toBe('nota')
    expect(r.effectiveQ).toBe('12345')
  })

  it('modo ordem para número longo (> 7 dígitos)', () => {
    const r = resolveSmartSearch('12345678', owners, 'todos', true)
    expect(r.mode).toBe('ordem')
  })

  it('modo responsavel quando texto bate exatamente num owner (global)', () => {
    const r = resolveSmartSearch('paula', owners, 'todos', true)
    expect(r.mode).toBe('responsavel')
    expect(r.derivedResponsavel).toBe('u1')
    expect(r.matchedOwnerLabel).toBe('Paula Matos')
    expect(r.effectiveQ).toBe('')
  })

  it('modo texto quando múltiplos owners batem', () => {
    const r = resolveSmartSearch('men', owners, 'todos', true)
    expect(r.mode).toBe('texto')
  })

  it('não faz match de responsavel quando canViewGlobal=false', () => {
    const r = resolveSmartSearch('paula', owners, 'todos', false)
    expect(r.mode).toBe('texto')
    expect(r.derivedResponsavel).toBeNull()
  })

  it('não faz match de responsavel quando filtro de responsavel já está definido', () => {
    const r = resolveSmartSearch('paula', owners, 'u2', true)
    expect(r.mode).toBe('texto')
  })
})

describe('resolveSmartSearch — robustez contra owners malformados', () => {
  it('ignora owners com id ou nome null/undefined', () => {
    const owners = [
      { id: 'u1', nome: 'Paula Matos' },
      { id: null as any, nome: 'Sem ID' },
      { id: 'u3', nome: null as any },
      { id: '', nome: '' },
      { id: 'u4', nome: 'Wanderlucio Mendes' },
    ]

    // Nenhuma chamada deve crashar
    const r = resolveSmartSearch('paula', owners, 'todos', true)
    expect(r.mode).toBe('responsavel')
    expect(r.derivedResponsavel).toBe('u1')

    // Busca vazia também não deve crashar
    const r2 = resolveSmartSearch('', owners, 'todos', true)
    expect(r2.mode).toBe('none')
  })
})
