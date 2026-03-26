'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Banknote,
  BarChart3,
  BarChartBig,
  HardHat,
  LineChart,
  ScrollText,
  Settings,
  ShieldAlert,
  UserCog,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/admin', label: 'Produtividade', icon: BarChart3, exact: true },
  { href: '/admin/graficos', label: 'Graficos', icon: LineChart },
  { href: '/admin/radar-preventivo', label: 'Radar Preventivo', icon: ShieldAlert },
  { href: '/admin/financeiro', label: 'Financeiro', icon: Banknote },
  { href: '/admin/comparativos', label: 'Comparativos', icon: BarChartBig },
  { href: '/admin/equipamentos', label: 'Equipamentos', icon: Zap },
  { href: '/admin/operacional', label: 'Operacional', icon: HardHat },
  { href: '/admin/pessoas', label: 'Pessoas', icon: UserCog },
  { href: '/admin/administracao', label: 'Administracao', icon: Settings },
  { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="mb-6 flex gap-1 border-b pb-px">
      {links.map((link) => {
        const Icon = link.icon
        const isActive = link.exact
          ? pathname === link.href
          : pathname.startsWith(link.href)

        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
