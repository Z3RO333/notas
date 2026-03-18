import { describe, expect, it } from 'vitest'
import {
  isSuelemKeepOrderCode,
  shouldForceSuelemByTextoBreve,
  shouldKeepRefrigeracaoOrderWithSuelem,
  shouldRouteOrderToRefrigeracao,
} from '@/lib/orders/refrigeracao-routing'

describe('refrigeracao-routing', () => {
  it('keeps only the explicit allowlist under Suelem', () => {
    expect(shouldKeepRefrigeracaoOrderWithSuelem('5222465')).toBe(true)
    expect(shouldKeepRefrigeracaoOrderWithSuelem(' 5224000 ')).toBe(true)
    expect(shouldKeepRefrigeracaoOrderWithSuelem('5223583')).toBe(false)
    expect(shouldKeepRefrigeracaoOrderWithSuelem(null)).toBe(false)
  })

  it('exposes the same decision helper for imperative flows', () => {
    expect(isSuelemKeepOrderCode('5223492')).toBe(true)
    expect(isSuelemKeepOrderCode('9999999')).toBe(false)
  })

  it('forces Suelem routing for the canonical ar-condicionado service text', () => {
    expect(shouldForceSuelemByTextoBreve('AR CONDICIONADO (ATÉ 60.000 BTUS)')).toBe(true)
    expect(shouldForceSuelemByTextoBreve('AR CONDICIONADO (ATE 60.000 BTUS)')).toBe(true)
    expect(shouldForceSuelemByTextoBreve('AR CONDICIONADO (VRF/CHILLER/SPLITAO)')).toBe(false)
    expect(shouldForceSuelemByTextoBreve(null)).toBe(false)
  })

  it('routes only high-confidence refrigeracao texts', () => {
    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: 'AR CONDICIONADO (ATE 60.000 BTUS)',
      descricao: null,
    })).toBe(true)

    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: 'MANUT. PREVENTIVA CENTRAIS DE AR',
      descricao: null,
    })).toBe(true)

    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: 'FREEZER',
      descricao: null,
    })).toBe(false)
  })

  it('blocks generic or automotive air-conditioning texts', () => {
    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: 'MANUTENCAO DE AR CONDICIONADO',
      descricao: null,
    })).toBe(false)

    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: 'MANUTENCAO DE AR CONDICIONADO DE VEICULO',
      descricao: null,
    })).toBe(false)
  })

  it('falls back to descricao only when texto_breve is absent', () => {
    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: null,
      descricao: 'AR CONDICIONADO (VRF/CHILLER/SPLITAO)',
    })).toBe(true)

    expect(shouldRouteOrderToRefrigeracao({
      textoBreve: 'INSTALACAO ELETRICA',
      descricao: 'AR CONDICIONADO (VRF/CHILLER/SPLITAO)',
    })).toBe(false)
  })
})
