import { describe, expect, it } from 'vitest'
import {
  classifyRawStatusBucket,
  deriveOrdemStatusFromRaw,
  isRawOrderActive,
  isRawOrderFinal,
} from '@/lib/orders/status-raw'

describe('status-raw', () => {
  it('classifies EM_PROCESSAMENTO as em_aberto', () => {
    expect(classifyRawStatusBucket('EM_PROCESSAMENTO')).toBe('em_aberto')
    expect(isRawOrderActive('EM_PROCESSAMENTO')).toBe(true)
    expect(deriveOrdemStatusFromRaw('EM_PROCESSAMENTO')).toBe('aberta')
  })

  it('classifies AVALIACAO_DE_EXECUCAO as em_avaliacao', () => {
    expect(classifyRawStatusBucket('AVALIACAO_DE_EXECUCAO')).toBe('em_avaliacao')
    expect(isRawOrderActive('AVALIACAO_DE_EXECUCAO')).toBe(true)
  })

  it('classifies EXECUCAO_SATISFATORIA as avaliada and final', () => {
    expect(classifyRawStatusBucket('EXECUCAO_SATISFATORIA')).toBe('avaliada')
    expect(isRawOrderFinal('EXECUCAO_SATISFATORIA')).toBe(true)
    expect(deriveOrdemStatusFromRaw('EXECUCAO_SATISFATORIA')).toBe('concluida')
  })

  it('classifies EXECUCAO_NAO_REALIZADA as nao_realizada and active', () => {
    expect(classifyRawStatusBucket('EXECUCAO_NAO_REALIZADA')).toBe('nao_realizada')
    expect(isRawOrderActive('EXECUCAO_NAO_REALIZADA')).toBe(true)
    expect(deriveOrdemStatusFromRaw('EXECUCAO_NAO_REALIZADA')).toBe('em_tratativa')
  })

  it('classifies AGUARDANDO_FATURAMENTO_NF as aguardando_faturamento and final', () => {
    expect(classifyRawStatusBucket('AGUARDANDO_FATURAMENTO_NF')).toBe('aguardando_faturamento')
    expect(isRawOrderFinal('AGUARDANDO_FATURAMENTO_NF')).toBe(true)
    expect(isRawOrderActive('AGUARDANDO_FATURAMENTO_NF')).toBe(false)
    expect(deriveOrdemStatusFromRaw('AGUARDANDO_FATURAMENTO_NF')).toBe('concluida')
  })

  it('classifies null as desconhecido and active', () => {
    expect(classifyRawStatusBucket(null)).toBe('desconhecido')
    expect(isRawOrderActive(null)).toBe(true)
    expect(isRawOrderFinal(null)).toBe(false)
    expect(deriveOrdemStatusFromRaw(null)).toBe('desconhecido')
  })
})
