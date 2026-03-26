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
    <div className="sticky top-0 z-30 -mx-4 mb-6 border-b bg-background/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background/95 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background/95 to-transparent" />
        <nav className="no-scrollbar flex snap-x gap-2 overflow-x-auto scroll-smooth pb-1 pr-6 [overscroll-behavior-x:contain]">
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
                  'inline-flex min-w-max snap-start items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border/70 bg-card/50 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
