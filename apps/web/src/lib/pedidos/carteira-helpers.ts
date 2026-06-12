import type {
  PedidosCarteiraFornecedorRow,
  PedidosCarteiraKpis,
  PedidosCarteiraTipo,
} from '@/lib/types/pedidos'

export const CARTEIRA_EMPTY_MESSAGES: Record<PedidosCarteiraTipo, string> = {
  corretiva: 'Nenhum fornecedor mapeado na carteira de corretivas.',
  preventiva_anual: 'Nenhum fornecedor mapeado na carteira de preventivas anuais.',
}

export function isValidCarteiraTipo(value: unknown): value is PedidosCarteiraTipo {
  return value === 'corretiva' || value === 'preventiva_anual'
}

export function filterCarteiraRowsByTipo(
  rows: PedidosCarteiraFornecedorRow[],
  tipo: PedidosCarteiraTipo
): PedidosCarteiraFornecedorRow[] {
  return rows.filter((row) => row.tipoCarteira === tipo)
}

export function deriveAvailableAdmins(
  rows: PedidosCarteiraFornecedorRow[]
): { id: string; nome: string; avatarUrl: string | null }[] {
  const seen = new Map<string, { id: string; nome: string; avatarUrl: string | null }>()

  for (const row of rows) {
    if (!seen.has(row.adminId)) {
      seen.set(row.adminId, {
        id: row.adminId,
        nome: row.adminNome ?? '',
        avatarUrl: row.adminAvatar,
      })
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export function buildCarteiraKpis(rows: PedidosCarteiraFornecedorRow[]): PedidosCarteiraKpis {
  return rows.reduce<PedidosCarteiraKpis>(
    (acc, row) => ({
      totalFornecedores: acc.totalFornecedores + 1,
      totalPedidos: acc.totalPedidos + row.qtdPedidos,
      emAberto: acc.emAberto + row.emAberto,
      encerrado: acc.encerrado + row.encerrado,
      cancelado: acc.cancelado + row.cancelado,
      valorTotal: acc.valorTotal + row.valorTotal,
    }),
    {
      totalFornecedores: 0,
      totalPedidos: 0,
      emAberto: 0,
      encerrado: 0,
      cancelado: 0,
      valorTotal: 0,
    }
  )
}
