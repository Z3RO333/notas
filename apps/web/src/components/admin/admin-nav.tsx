'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Banknote,
  BarChart3,
  BarChartBig,
  HardHat,
  LineChart,
  Menu,
  ScrollText,
  Settings,
  ShieldAlert,
  UserCog,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type AdminNavLink = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

type AdminNavSection = {
  title: string
  links: AdminNavLink[]
}

const navSections: AdminNavSection[] = [
  {
    title: 'Visão geral',
    links: [
      { href: '/admin', label: 'Produtividade', icon: BarChart3, exact: true },
      { href: '/admin/graficos', label: 'Gráficos', icon: LineChart },
      { href: '/admin/comparativos', label: 'Comparativos', icon: BarChartBig },
      { href: '/admin/financeiro', label: 'Financeiro', icon: Banknote },
    ],
  },
  {
    title: 'Operação',
    links: [
      { href: '/admin/radar-preventivo', label: 'Radar Preventivo', icon: ShieldAlert },
      { href: '/admin/operacional', label: 'Operacional', icon: HardHat },
      { href: '/admin/equipamentos', label: 'Equipamentos', icon: Zap },
    ],
  },
  {
    title: 'Gestão',
    links: [
      { href: '/admin/pessoas', label: 'Pessoas', icon: UserCog },
      { href: '/admin/administracao', label: 'Administração', icon: Settings },
      { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
    ],
  },
]

function isLinkActive(pathname: string, link: AdminNavLink) {
  return link.exact ? pathname === link.href : pathname.startsWith(link.href)
}

function getActiveEntry(pathname: string) {
  for (const section of navSections) {
    for (const link of section.links) {
      if (isLinkActive(pathname, link)) {
        return { section, link }
      }
    }
  }

  return {
    section: navSections[0],
    link: navSections[0].links[0],
  }
}

function AdminNavSections({
  pathname,
  onNavigate,
  className,
}: {
  pathname: string
  onNavigate?: () => void
  className?: string
}) {
  return (
    <nav aria-label="Navegação administrativa" className={cn('space-y-5', className)}>
      {navSections.map((section) => {
        const sectionIsActive = section.links.some((link) => isLinkActive(pathname, link))

        return (
          <section key={section.title} className="space-y-2">
            <div className="px-2">
              <p
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground',
                  sectionIsActive && 'text-primary',
                )}
              >
                {section.title}
              </p>
            </div>

            <div className="space-y-1">
              {section.links.map((link) => {
                const Icon = link.icon
                const isActive = isLinkActive(pathname, link)

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={onNavigate}
                    className={cn(
                      'group flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition-colors',
                      isActive
                        ? 'border-primary/25 bg-primary/10 text-primary shadow-sm'
                        : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
                        isActive
                          ? 'border-primary/20 bg-background text-primary'
                          : 'border-border/70 bg-background/70 text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{link.label}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </nav>
  )
}

export function AdminNav() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const activeEntry = getActiveEntry(pathname)

  return (
    <>
      <div className="mb-4 lg:hidden">
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card/70 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Admin
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {activeEntry.link.label}
            </p>
            <p className="truncate text-xs text-muted-foreground">{activeEntry.section.title}</p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMobileOpen(true)}
            className="shrink-0 rounded-full"
          >
            <Menu className="h-4 w-4" />
            Seções
          </Button>
        </div>

        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-full max-w-[320px] flex-col border-r bg-background shadow-xl outline-none">
              <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
                <div className="space-y-1">
                  <DialogTitle className="text-base">Navegação do admin</DialogTitle>
                  <DialogDescription>
                    Escolha a área que você quer analisar ou operar.
                  </DialogDescription>
                </div>

                <DialogPrimitive.Close asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Fechar seções do admin">
                    <X className="h-4 w-4" />
                  </Button>
                </DialogPrimitive.Close>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-4">
                <AdminNavSections pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </Dialog>
      </div>

      <aside className="hidden self-start lg:block lg:sticky lg:top-16 lg:h-[calc(100vh-4.5rem)]">
        <div className="flex h-full flex-col overflow-hidden rounded-[24px] border bg-card/70 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="shrink-0 border-b px-4 pb-4 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Painel admin
            </p>
            <p className="mt-2 text-base font-semibold tracking-tight text-foreground">
              Navegação da área
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Análises, operação e gestão em uma estrutura mais fácil de escanear.
            </p>
          </div>

          <AdminNavSections
            pathname={pathname}
            className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-4 pr-2"
          />
        </div>
      </aside>
    </>
  )
}
