import { AdminOrderTypeOwnerManager } from '@/components/admin/admin-order-type-owner-manager'
import { AdminPeopleManager } from '@/components/admin/admin-people-manager'
import { loadAdministrationPageData } from '@/lib/admin/load-administration-page-data'

export const dynamic = 'force-dynamic'

export default async function AdministracaoPage() {
  const data = await loadAdministrationPageData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administracao</h1>
        <p className="text-sm text-muted-foreground">
          Gestao de pessoas e responsavel PMPL com substituicao automatica em ferias.
        </p>
      </div>

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
