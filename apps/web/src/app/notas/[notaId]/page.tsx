import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotaDetail } from '@/components/notas/nota-detail'
import { NotaActions } from '@/components/notas/nota-actions'
import { NotaHistoricoTimeline } from '@/components/notas/nota-historico'
import { BackButton } from '@/components/notas/back-button'
import { ReassignDialog } from '@/components/dashboard/reassign-dialog'

interface PageProps {
  params: Promise<{ notaId: string }>
}

export default async function NotaDetailPage({ params }: PageProps) {
  const { notaId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [notaResult, historicoResult, adminsResult] = await Promise.all([
    supabase
      .from('notas_manutencao')
      .select('*, administradores(nome, email)')
      .eq('id', notaId)
      .single(),
    supabase
      .from('notas_historico')
      .select('*, administradores:alterado_por(nome)')
      .eq('nota_id', notaId)
      .order('created_at', { ascending: false }),
    supabase
      .from('administradores')
      .select('*')
      .eq('role', 'admin')
      .eq('ativo', true)
      .eq('em_ferias', false),
  ])

  if (notaResult.error || !notaResult.data) {
    notFound()
  }

  const nota = notaResult.data
  const admins = adminsResult.data ?? []
  const loggedAdminResult = user?.email
    ? await supabase
      .from('administradores')
      .select('role')
      .eq('email', user.email)
      .single()
    : { data: null }
  const loggedRole = loggedAdminResult.data?.role ?? null

  const hasOrder = Boolean(
    (nota.ordem_sap && nota.ordem_sap.trim().length > 0)
      || (nota.ordem_gerada && nota.ordem_gerada.trim().length > 0)
  )
  const canReassign = loggedRole === 'gestor'
    && nota.administrador_id
    && (hasOrder || (nota.status !== 'concluida' && nota.status !== 'cancelada'))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Nota {nota.numero_nota}</h1>
          {nota.administradores?.nome && (
            <p className="text-sm text-muted-foreground">
              Responsável: {nota.administradores.nome}
            </p>
          )}
        </div>
        {canReassign && (
          <ReassignDialog
            notaId={nota.id}
            notaNumero={nota.numero_nota}
            currentAdminId={nota.administrador_id}
            admins={admins}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <NotaDetail nota={nota} />
        </div>
        <div className="space-y-6">
          <NotaActions
            notaId={nota.id}
            currentStatus={nota.status}
            hasAdmin={!!nota.administrador_id}
          />
          <NotaHistoricoTimeline historico={historicoResult.data ?? []} />
        </div>
      </div>
    </div>
  )
}
