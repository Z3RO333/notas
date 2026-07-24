import { Suspense } from 'react'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import type { AdminProductivityPeriod } from '@/lib/dashboard/productivity-month'
import { AdminOrdersSectionSkeleton } from './admin-orders-section-skeleton'
import { AdminProductivityFilter } from './admin-productivity-filter'
import { AdminProductivityPanel } from './admin-productivity-panel'

interface AdminDashboardContentProps {
  period: AdminProductivityPeriod
  yearOptions: number[]
  especialidade?: string | null
}

export function AdminDashboardContent({
  period,
  yearOptions,
  especialidade,
}: AdminDashboardContentProps) {
  return (
    <div className="space-y-6">
      <PageTitleBlock title="Produtividade Mensal" />

      <div className="sticky top-14 z-20 bg-background/85 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <AdminProductivityFilter
          selectedYear={period.year}
          selectedMonth={period.month}
          yearOptions={yearOptions}
          selectedEspecialidade={especialidade}
        />
      </div>

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Produtividade" includeRanking />}>
        <AdminProductivityPanel period={period} especialidade={especialidade} />
      </Suspense>
    </div>
  )
}
