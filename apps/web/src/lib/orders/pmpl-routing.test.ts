import { describe, expect, it } from 'vitest'
import { shouldRouteOrderToPmpl } from '@/lib/orders/pmpl-routing'

describe('pmpl-routing', () => {
  it('routes canonical PMPL tipo_ordem directly', () => {
    expect(shouldRouteOrderToPmpl({
      tipoOrdem: 'PMPL',
      textoBreve: 'QUALQUER TEXTO',
      descricao: null,
    })).toBe(true)
  })

  it('routes preventiva de 1.500 horas by texto_breve even when tipo_ordem is absent', () => {
    expect(shouldRouteOrderToPmpl({
      tipoOrdem: null,
      textoBreve: 'PREVENTIVA DE 1.500 HORAS',
      descricao: null,
    })).toBe(true)

    expect(shouldRouteOrderToPmpl({
      tipoOrdem: null,
      textoBreve: 'PREVENTIVA DE 1500 HORAS',
      descricao: null,
    })).toBe(true)
  })

  it('falls back to descricao when texto_breve is empty', () => {
    expect(shouldRouteOrderToPmpl({
      tipoOrdem: null,
      textoBreve: null,
      descricao: 'PREVENTIVA DE 1.500 HORAS',
    })).toBe(true)
  })

  it('does not route unrelated texts to PMPL', () => {
    expect(shouldRouteOrderToPmpl({
      tipoOrdem: null,
      textoBreve: 'INSTALACAO ELETRICA',
      descricao: null,
    })).toBe(false)
  })
})
