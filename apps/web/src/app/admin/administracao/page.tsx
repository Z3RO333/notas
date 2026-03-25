import { AdminOrderTypeOwnerManager } from '@/components/admin/admin-order-type-owner-manager'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { AdminPeopleManager } from '@/components/admin/admin-people-manager'
import { loadAdministrationPageData } from '@/lib/admin/load-administration-page-data'

export const dynamic = 'force-dynamic'

export default async function AdministracaoPage() {
  const data = await loadAdministrationPageData()

  return (
    <div className="space-y-6">
      <PageTitleBlock title="Administração" subtitle="Gestão de pessoas e responsável PMPL com substituição automática em férias." />

      <AdminPeopleManager
        people={data.people}
        pmplResponsavelId={data.pmplConfig?.responsavel_id ?? data.pmplResolution.configuredResponsavel?.id ?? null}
        pmplSubstitutoId={data.pmplConfig?.substituto_id ?? data.pmplResolution.configuredSubstituto?.id ?? null}
      />

      <AdminOrderTypeOwnerManager
        candidates={data.ownerCandidates}
        initialResponsavelId={data.pmplConfig?.responsavel_id ?? null}
        initialSubstitutoId={data.pmplConfig?.substituto_id ?? null}
        configuredResponsavelNome={data.configuredResponsavelNome}
        configuredSubstitutoNome={data.configuredSubstitutoNome}
        currentOwnerNome={data.currentOwnerNome}
        currentOwnerEmail={data.currentOwnerEmail}
        currentOwnerStatus={data.currentOwnerStatus}
        fallbackGestorNome={data.fallbackGestorNome}
        configLoadError={data.configLoadError}
      />
    </div>
  )
}
