import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { OrdersKpiStrip } from '@/components/orders/orders-kpi-strip'
import { OrdersOwnerPanel } from '@/components/orders/orders-owner-panel'
import { OrdersRankingAdmin } from '@/components/orders/orders-ranking-admin'
import { OrdersRankingUnidade } from '@/components/orders/orders-ranking-unidade'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import {
  buildOrderKpis,
  buildOrderRankingAdmin,
  buildOrderRankingUnidade,
  parseOrderWindow,
} from '@/lib/orders/metrics'
import type {
  OrderReassignTarget,
  OrderWindowFilter,
  OrdemNotaAcompanhamento,
  UserRole,
} from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const ORDER_WINDOW_OPTIONS: OrderWindowFilter[] = [30, 90, 180]

interface OrdersPageProps {
  searchParams?: Promise<{
    janela?: string | string[]
  }>
}

type OrdersSearchParams = {
  janela?: string | string[]
}

function getSelectedWindow(searchParams?: OrdersSearchParams): OrderWindowFilter {
  const raw = Array.isArray(searchParams?.janela)
    ? searchParams.janela[0]
    : searchParams?.janela
  return parseOrderWindow(raw)
}

function toUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor') return value
  return null
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const orderWindow = getSelectedWindow(resolvedSearchParams)
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - (orderWindow - 1))

  const { data: { user } } = await supabase.auth.getUser()

  const loggedAdminResult = user?.email
    ? await supabase
      .from('administradores')
      .select('id, role')
      .eq('email', user.email)
      .single()
    : { data: null }

  const currentAdminId = loggedAdminResult.data?.id ?? null
  const currentUserRole = toUserRole(loggedAdminResult.data?.role)

  const ordensResult = await supabase
    .from('vw_ordens_notas_painel')
    .select('*')
    .gte('ordem_detectada_em', cutoff.toISOString())
    .order('ordem_detectada_em', { ascending: false })
    .limit(600)

  const allRows = (ordensResult.data ?? []) as OrdemNotaAcompanhamento[]
  const rows = currentUserRole === 'gestor'
    ? allRows
    : allRows.filter((row) => {
      if (!currentAdminId) return false
      if (row.responsavel_atual_id === currentAdminId) return true
      if (row.administrador_id === currentAdminId) return true
      return (row.envolvidos_admin_ids ?? []).includes(currentAdminId)
    })

  const orderKpis = buildOrderKpis(rows)
  const rankingAdmin = currentUserRole === 'gestor' ? buildOrderRankingAdmin(rows) : []
  const rankingUnidade = currentUserRole === 'gestor' ? buildOrderRankingUnidade(rows) : []

  let reassignTargets: OrderReassignTarget[] = []
  if (currentUserRole === 'gestor') {
    const { data } = await supabase
      .from('administradores')
      .select('id, nome')
      .eq('role', 'admin')
      .eq('ativo', true)
      .eq('em_ferias', false)
      .order('nome')
    reassignTargets = (data ?? []) as OrderReassignTarget[]
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel de Ordens</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhamento das ordens originadas de notas com vinculo nota x ordem.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {ORDER_WINDOW_OPTIONS.map((windowDays) => (
            <Link
              key={windowDays}
              href={`/ordens?janela=${windowDays}`}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                orderWindow === windowDays
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {windowDays} dias
            </Link>
          ))}
        </div>
      </div>

      <OrdersKpiStrip kpis={orderKpis} windowDays={orderWindow} />

      <OrdersOwnerPanel
        rows={rows}
        canReassign={currentUserRole === 'gestor'}
        reassignTargets={reassignTargets}
      />

      {currentUserRole === 'gestor' && (
        <>
          <OrdersRankingAdmin rows={rankingAdmin.slice(0, 12)} windowDays={orderWindow} />
          <OrdersRankingUnidade rows={rankingUnidade.slice(0, 12)} windowDays={orderWindow} />
        </>
      )}

      <RealtimeListener />
    </div>
  )
}
