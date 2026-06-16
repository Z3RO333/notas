import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { SaidasNovaForm } from '@/components/saidas/saidas-nova-form'

export const metadata: Metadata = { title: 'Nova Saída Operacional | Cockpit' }

export default async function SaidasNovaPage() {
  const supabase = await createClient()
  const { data: operacionais } = await supabase
    .from('dim_operacionais')
    .select('codigo, nome')
    .eq('ativo', true)
    .order('nome')

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Nova saída operacional</h1>
        <p className="text-sm text-muted-foreground">Selecione o técnico e as ordens que ele vai atender</p>
      </div>
      <SaidasNovaForm operacionais={(operacionais ?? []) as { codigo: string; nome: string }[]} />
    </div>
  )
}
