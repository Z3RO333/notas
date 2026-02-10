import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { NotaDetail } from '@/components/notas/nota-detail'
import { NotaActions } from '@/components/notas/nota-actions'
import { NotaHistoricoTimeline } from '@/components/notas/nota-historico'
import { Button } from '@/components/ui/button'

interface PageProps {
  params: Promise<{ notaId: string }>
}

export default async function NotaDetailPage({ params }: PageProps) {
  const { notaId } = await params
  const supabase = createClient()

  const [notaResult, historicoResult] = await Promise.all([
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
  ])

  if (notaResult.error || !notaResult.data) {
    notFound()
  }

  const nota = notaResult.data

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Nota {nota.numero_nota}</h1>
          {nota.administradores?.nome && (
            <p className="text-sm text-muted-foreground">
              Responsavel: {nota.administradores.nome}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <NotaDetail nota={nota} />
        </div>
        <div className="space-y-6">
          <NotaActions
            notaId={nota.id}
            currentStatus={nota.status}
            administradorId={nota.administrador_id}
          />
          <NotaHistoricoTimeline historico={historicoResult.data ?? []} />
        </div>
      </div>
    </div>
  )
}
