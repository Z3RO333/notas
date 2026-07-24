import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { SaidasListaPanel } from '@/components/saidas/saidas-lista-panel'

export const metadata: Metadata = { title: 'Saídas Operacionais | Cockpit' }
export const dynamic = 'force-dynamic'

export default async function SaidasPage() {
  const supabase = createAdminClient()
  const { data: operacionais } = await supabase
    .from('dim_operacionais')
    .select('codigo, nome')
    .eq('ativo', true)
    .order('nome')

  return (
    <div className="py-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Saídas Operacionais</h1>
          <p className="text-sm text-muted-foreground">Registro de ordens enviadas ao campo</p>
        </div>
      </div>
      <SaidasListaPanel operacionais={(operacionais ?? []) as { codigo: string; nome: string }[]} />
    </div>
  )
}
