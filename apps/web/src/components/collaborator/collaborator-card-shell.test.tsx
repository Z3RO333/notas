import { render, screen } from '@testing-library/react'
import { CheckCircle2, Clock3 } from 'lucide-react'
import { CollaboratorCardShell } from '@/components/collaborator/collaborator-card-shell'
import { getCargoPresentationByLabel } from '@/lib/collaborator/cargo-presentation'
import { describe, expect, it } from 'vitest'

describe('CollaboratorCardShell', () => {
  it('renders hierarchy name > cargo > metrics in operational variant', () => {
    render(
      <CollaboratorCardShell
        variant="operational"
        name="Adriano Bezerra"
        avatarUrl={null}
        cargo={getCargoPresentationByLabel('CD TURISMO')}
        primaryMetric={{
          id: 'primary',
          label: 'Total de ordens',
          value: 120,
          tone: 'info',
          icon: CheckCircle2,
        }}
        secondaryMetrics={[
          {
            id: 'secondary-1',
            label: '0-2d',
            value: 12,
            tone: 'success',
            icon: Clock3,
          },
        ]}
      />
    )

    expect(screen.getByText('Adriano Bezerra')).toBeInTheDocument()
    expect(screen.getByText('CD TURISMO')).toBeInTheDocument()
    expect(screen.getByText('Total de ordens')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('0-2d')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders compact variant with details and summary', () => {
    render(
      <CollaboratorCardShell
        variant="compact"
        name="Brenda Rodrigues"
        avatarUrl={null}
        cargo={getCargoPresentationByLabel('CD MANAUS')}
        primaryMetric={{
          id: 'primary',
          label: 'Concluídas',
          value: 32,
          tone: 'success',
        }}
        summary={<span>Resumo compacto</span>}
        details={<p>Detalhes extras</p>}
      />
    )

    expect(screen.getByText('Brenda Rodrigues')).toBeInTheDocument()
    expect(screen.getByText('CD MANAUS')).toBeInTheDocument()
    expect(screen.getByText('Concluídas')).toBeInTheDocument()
    expect(screen.getByText('32')).toBeInTheDocument()
    expect(screen.getByText('Resumo compacto')).toBeInTheDocument()
    expect(screen.getByText('Detalhes extras')).toBeInTheDocument()
  })

  it('applies unassigned accent for SEM RESPONSÁVEL cards', () => {
    const { container } = render(
      <CollaboratorCardShell
        variant="compact"
        name="Não atribuídas"
        avatarUrl={null}
        cargo={getCargoPresentationByLabel('SEM RESPONSÁVEL')}
        primaryMetric={{ id: 'primary', label: 'Notas abertas', value: 7 }}
      />
    )

    const rootCard = container.querySelector('.border-orange-200')
    expect(rootCard).toBeInTheDocument()
    expect(screen.getByText('SEM RESPONSÁVEL')).toBeInTheDocument()
  })
})
