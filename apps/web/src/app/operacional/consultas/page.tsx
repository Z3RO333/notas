import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { ConsultasPanel } from '@/components/operacional/consultas-panel'

export const metadata: Metadata = { title: 'Consulta de Ordens | Cockpit' }

export default async function ConsultasPage() {
  const context = await getCurrentAdminContext()

  let operacionalCodigo: string | null = null
  if (context.adminId) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('administradores')
      .select('operacional_codigo')
      .eq('id', context.adminId)
      .maybeSingle()
    operacionalCodigo = (data as { operacional_codigo?: string | null } | null)?.operacional_codigo ?? null
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Consulta de Ordens</h1>
        <p className="text-sm text-muted-foreground">Pesquise ordens de manutenção por número, unidade ou fornecedor</p>
      </div>
      <ConsultasPanel operacionalCodigo={operacionalCodigo} />
    </div>
  )
}
