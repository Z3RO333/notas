import { describe, expect, it } from 'vitest'
import { validarEmailsAdicionais } from '@/lib/actions/admin-actions-emails'

describe('validarEmailsAdicionais', () => {
  it('normaliza para lowercase e remove espaços', () => {
    expect(validarEmailsAdicionais([' Maura@Bemol.com.br '])).toEqual(['maura@bemol.com.br'])
  })

  it('remove duplicatas', () => {
    expect(validarEmailsAdicionais(['a@bemol.com.br', 'A@bemol.com.br'])).toEqual(['a@bemol.com.br'])
  })

  it('rejeita email fora do domínio bemol', () => {
    expect(() => validarEmailsAdicionais(['a@gmail.com'])).toThrow('Email deve terminar com @bemol.com.br')
  })

  it('rejeita email vazio na lista', () => {
    expect(() => validarEmailsAdicionais(['', 'a@bemol.com.br'])).toThrow('Email adicional vazio')
  })

  it('lista vazia retorna lista vazia', () => {
    expect(validarEmailsAdicionais([])).toEqual([])
  })
})
