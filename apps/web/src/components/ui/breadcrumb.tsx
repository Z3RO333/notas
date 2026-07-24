'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const ADMIN_LABELS: Record<string, string> = {
  admin: 'Admin',
  administracao: 'Administração',
  auditoria: 'Auditoria',
  comparativos: 'Comparativos',
  copilot: 'Copilot',
  distribuicao: 'Distribuição',
  equipamentos: 'Equipamentos',
  financeiro: 'Financeiro',
  graficos: 'Gráficos',
  operacional: 'Operacional',
  mapa: 'Mapa',
  pessoas: 'Pessoas',
  'radar-preventivo': 'Radar Preventivo',
}

export function Breadcrumb() {
  const pathname = usePathname()
  if (!pathname || !pathname.startsWith('/admin')) return null

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length <= 1) return null  // Só "/admin" — sem breadcrumb

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
      {segments.map((segment, idx) => {
        const href = '/' + segments.slice(0, idx + 1).join('/')
        const label = ADMIN_LABELS[segment] ?? segment
        const isLast = idx === segments.length - 1

        return (
          <span key={href} className="flex items-center gap-1.5">
            {idx > 0 && <ChevronRight className="h-3 w-3 opacity-60" />}
            {isLast ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link href={href} className="transition-colors hover:text-foreground">
                {label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
