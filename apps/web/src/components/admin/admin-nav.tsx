'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, UserCog, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/admin', label: 'Dashboard', icon: BarChart3, exact: true },
  { href: '/admin/pessoas', label: 'Pessoas', icon: UserCog },
  { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 border-b pb-px mb-6">
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
              'flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors border-b-2',
              isActive
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
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
