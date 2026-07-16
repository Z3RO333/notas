import { createAdminClient } from '@/lib/supabase/admin'
import {
  listarCarteiraPmpl,
  listarFornecedoresSemDono,
} from '@/lib/orders/pmpl-carteira-queries'
import { PmplCarteiraTable } from '@/components/admin/pmpl/pmpl-carteira-table'

export async function PmplCarteiraSection({ isGestor }: { isGestor: boolean }) {
  const supabase = createAdminClient()

  const [rows, semDono, candidatesResult] = await Promise.all([
    listarCarteiraPmpl(supabase),
    listarFornecedoresSemDono(supabase),
    supabase
      .from('administradores')
      .select('id, nome, email')
      .eq('ativo', true)
      .eq('role', 'admin')
      .order('nome'),
  ])

  const candidates = (candidatesResult.data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome ?? null,
    email: c.email,
  }))

  return (
    <section className="space-y-4 rounded-[28px] border border-border/60 bg-card/35 p-4 shadow-sm sm:p-5 lg:p-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Carteiras PMPL
          </p>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Responsáveis por fornecedor PMPL
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Cada fornecedor PMPL tem um responsável fixo. Realoque aqui ao precisar cobrir férias, sobrecarga ou ajuste de carteira.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
            {rows.length} fornecedores mapeados
          </span>
          <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
            {rows.reduce((s, r) => s + r.qtdAbertas, 0).toLocaleString('pt-BR')} ordens abertas
          </span>
        </div>
      </div>

      <PmplCarteiraTable
        rows={rows}
        semDono={semDono}
        candidates={candidates}
        isGestor={isGestor}
      />
    </section>
  )
}
