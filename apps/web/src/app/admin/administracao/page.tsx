import { SATURDAY_SCHEDULE_QUERY_PARAM } from '@/lib/admin/saturday-distribution-schedule'
import { readFirstParam } from '@/lib/grid/query'
import { AdminSaturdayScheduleManager } from '@/components/admin/admin-saturday-schedule-manager'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { AdminPeopleManager } from '@/components/admin/admin-people-manager'
import { AdminOperacionaisManager } from '@/components/admin/operacional/admin-operacionais-manager'
import { loadAdministrationPageData } from '@/lib/admin/load-administration-page-data'

export const dynamic = 'force-dynamic'

interface AdministracaoPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function AdministracaoPage({ searchParams }: AdministracaoPageProps) {
  const params = (await searchParams) ?? {}
  const data = await loadAdministrationPageData({
    selectedSaturdayScheduleMonth: readFirstParam(params[SATURDAY_SCHEDULE_QUERY_PARAM]),
  })

  return (
    <div className="space-y-6">
      <PageTitleBlock title="Administração" subtitle="Gestão de pessoas, disponibilidade e escala de sábado." />

      <AdminPeopleManager
        people={data.people}
      />

      <AdminSaturdayScheduleManager
        selectedMonthKey={data.saturdayScheduleMonthKey}
        candidates={data.saturdayScheduleCandidates}
        slots={data.saturdayScheduleSlots}
      />

      <AdminOperacionaisManager
        operacionais={data.operacionais}
        todasUnidades={data.todasUnidades}
      />
    </div>
  )
}
