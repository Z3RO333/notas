'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'

export type NotaOperacaoEstadoRow = Record<string, unknown>

export async function listarNotasOperacaoEstado(): Promise<NotaOperacaoEstadoRow[]> {
  const email = await getSessionEmail()
  if (!email) throw new Error('Nao autenticado')

  const supabase = createAdminClient()

  const { data: admin } = await supabase
    .from('vw_administrador_por_email')
    .select('id, role')
    .eq('email', email)
    .maybeSingle()

  if (!admin) throw new Error('Administrador nao encontrado')

  let query = supabase.from('notas_operacao_estado').select('*')

  // Replica a policy RLS original (00206_allow_viewer_read_notes_panel.sql):
  // gestor/viewer veem tudo, admin comum só vê o estado operacional das notas
  // que ele mesmo administra.
  if (admin.role !== 'gestor' && admin.role !== 'viewer') {
    const { data: notasProprias } = await supabase
      .from('notas_manutencao')
      .select('id')
      .eq('administrador_id', admin.id)

    const notaIds = (notasProprias ?? []).map((n) => n.id)
    if (notaIds.length === 0) return []
    query = query.in('nota_id', notaIds)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as NotaOperacaoEstadoRow[]
}
