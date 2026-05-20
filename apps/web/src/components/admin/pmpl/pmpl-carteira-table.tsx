'use client'

import { useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, ArrowLeftRight, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { PmplCarteiraRow, PmplFornecedorSemDono } from '@/lib/orders/pmpl-carteira-queries'
import { PmplRealocarDialog } from './pmpl-realocar-dialog'

interface AdminCandidate {
  id: string
  nome: string | null
  email: string
}

interface PmplCarteiraTableProps {
  rows: PmplCarteiraRow[]
  semDono: PmplFornecedorSemDono[]
  candidates: AdminCandidate[]
  isGestor: boolean
}

const ALL_VALUE = '__all__'

export function PmplCarteiraTable({ rows, semDono, candidates, isGestor }: PmplCarteiraTableProps) {
  const [busca, setBusca] = useState('')
  const [filtroAdmin, setFiltroAdmin] = useState(ALL_VALUE)
  const [mostrarSemDono, setMostrarSemDono] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<PmplCarteiraRow | null>(null)

  const adminsUnicos = Array.from(
    new Map(rows.map((r) => [r.adminId, { id: r.adminId, nome: r.adminNome }])).values(),
  ).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'))

  const rowsFiltradas = rows.filter((row) => {
    if (filtroAdmin !== ALL_VALUE && row.adminId !== filtroAdmin) return false
    if (busca) {
      const q = busca.toLowerCase()
      const nome = (row.fornecedorNome ?? '').toLowerCase()
      const codigo = row.fornecedorCodigo.toLowerCase()
      if (!nome.includes(q) && !codigo.includes(q)) return false
    }
    return true
  })

  function handleTrocar(row: PmplCarteiraRow) {
    setSelectedRow(row)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      {semDono.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <span className="font-medium text-amber-900 dark:text-amber-200">
              {semDono.length} fornecedor{semDono.length > 1 ? 'es' : ''} PMPL sem responsável
            </span>
            <span className="ml-1 text-amber-700 dark:text-amber-400">
              — {semDono.reduce((s, r) => s + r.qtdAbertas, 0).toLocaleString('pt-BR')} ordens abertas sem dono.
            </span>
            <button
              type="button"
              onClick={() => setMostrarSemDono((v) => !v)}
              className="ml-2 underline underline-offset-2 text-amber-800 dark:text-amber-300 hover:text-amber-900"
            >
              {mostrarSemDono ? 'Ocultar' : 'Ver fornecedores'}
            </button>
          </div>
        </div>
      )}

      {mostrarSemDono && semDono.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-card/40 divide-y divide-border/40">
          {semDono.map((row) => (
            <div key={row.fornecedorCodigo} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span className="font-medium">{row.fornecedorNome ?? row.fornecedorCodigo}</span>
                <span className="ml-2 text-muted-foreground text-xs">cod. {row.fornecedorCodigo}</span>
              </div>
              <span className="text-muted-foreground">{row.qtdAbertas.toLocaleString('pt-BR')} abertas</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar fornecedor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={filtroAdmin} onValueChange={setFiltroAdmin}>
          <SelectTrigger className="h-8 w-[180px] text-sm">
            <SelectValue placeholder="Todos os responsáveis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos os responsáveis</SelectItem>
            {adminsUnicos.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nome ?? a.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-[12px] border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Fornecedor
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Responsável
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Abertas
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Atrasadas
              </th>
              {isGestor && (
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ação
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rowsFiltradas.length === 0 && (
              <tr>
                <td colSpan={isGestor ? 5 : 4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum fornecedor encontrado.
                </td>
              </tr>
            )}
            {rowsFiltradas.map((row) => (
              <tr key={row.fornecedorCodigo} className="bg-card/30 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium leading-tight">{row.fornecedorNome ?? row.fornecedorCodigo}</p>
                  <p className="text-xs text-muted-foreground">cod. {row.fornecedorCodigo}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {row.adminAvatar ? (
                      <Image
                        src={row.adminAvatar}
                        alt={row.adminNome ?? ''}
                        width={24}
                        height={24}
                        className="rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                        {(row.adminNome ?? '?')[0]?.toUpperCase()}
                      </div>
                    )}
                    <span>{row.adminNome ?? '—'}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.qtdAbertas.toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.qtdAtrasadas > 0 ? (
                    <Badge variant="destructive" className="text-xs">
                      {row.qtdAtrasadas.toLocaleString('pt-BR')}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {isGestor && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => handleTrocar(row)}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Trocar
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRow && (
        <PmplRealocarDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          fornecedorCodigo={selectedRow.fornecedorCodigo}
          fornecedorNome={selectedRow.fornecedorNome}
          adminAtualId={selectedRow.adminId}
          adminAtualNome={selectedRow.adminNome}
          candidates={candidates}
        />
      )}
    </div>
  )
}
