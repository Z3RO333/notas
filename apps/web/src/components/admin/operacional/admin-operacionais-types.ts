import type { OperacionalAdmin } from '@/lib/types/database'

export type { OperacionalAdmin }

export interface OperacionalFormState {
  codigo: string
  nome: string
  ativo: boolean
  especialidade: string
  /** "unidade||grupo_nome" ou só "unidade" quando sem grupo */
  unidadesRaw: string[]
}

export const EMPTY_OPERACIONAL_FORM: OperacionalFormState = {
  codigo: '',
  nome: '',
  ativo: true,
  especialidade: '',
  unidadesRaw: [],
}

export function toOperacionalFormState(op: OperacionalAdmin): OperacionalFormState {
  return {
    codigo: op.codigo,
    nome: op.nome,
    ativo: op.ativo,
    especialidade: op.especialidade ?? '',
    unidadesRaw: op.unidades.map((u) =>
      u.grupo_nome ? `${u.unidade}||${u.grupo_nome}` : u.unidade,
    ),
  }
}

export function parseUnidadesRaw(
  raw: string[],
): Array<{ unidade: string; grupo_nome: string | null }> {
  return raw
    .map((entry) => {
      const sep = entry.indexOf('||')
      if (sep === -1) return { unidade: entry.trim(), grupo_nome: null }
      return {
        unidade: entry.slice(0, sep).trim(),
        grupo_nome: entry.slice(sep + 2).trim() || null,
      }
    })
    .filter((u) => u.unidade.length > 0)
}
