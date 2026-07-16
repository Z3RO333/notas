'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import {
  Banknote,
  BarChart3,
  BarChartBig,
  ClipboardList,
  HardHat,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Truck,
  UserCog,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { signOut } from 'next-auth/react'
import { AppMainShell } from '@/components/layout/app-main-shell'
import { ThemeSelector } from '@/components/theme/theme-selector'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PrefetchLink } from '@/components/shared/prefetch-link'
import { cn } from '@/lib/utils'

interface CockpitShellProps {
  children: React.ReactNode
  userName?: string | null
  userRole?: string | null
}

type ShellNavLink = {
  href: string
  label: string
  shortLabel?: string
  section: string
  icon: LucideIcon
  exact?: boolean
  gestorOnly?: boolean
}

const NAV_LINKS: ShellNavLink[] = [
  { href: '/', label: 'Notas', section: 'Operação', icon: ClipboardList, exact: true },
  { href: '/ordens', label: 'Ordens', section: 'Operação', icon: ListChecks },
  { href: '/pedidos', label: 'Pedidos de Compra', shortLabel: 'Pedidos', section: 'Operação', icon: ShoppingCart },
  { href: '/admin', label: 'Produtividade', section: 'Admin', icon: BarChart3, exact: true, gestorOnly: true },
  { href: '/admin/graficos', label: 'Graficos', section: 'Admin', icon: LineChart, gestorOnly: true },
  { href: '/admin/comparativos', label: 'Comparativos', section: 'Admin', icon: BarChartBig, gestorOnly: true },
  { href: '/admin/financeiro', label: 'Financeiro', section: 'Admin', icon: Banknote, gestorOnly: true },
  { href: '/admin/operacional', label: 'Operacional', section: 'Campo', icon: HardHat, gestorOnly: true },
  { href: '/admin/saidas', label: 'Saídas', section: 'Operação', icon: Truck, gestorOnly: true },
  { href: '/admin/radar-preventivo', label: 'Radar Preventivo', shortLabel: 'Radar', section: 'Campo', icon: ShieldAlert, gestorOnly: true },
  { href: '/admin/equipamentos', label: 'Equipamentos', section: 'Campo', icon: Zap, gestorOnly: true },
  { href: '/admin/pessoas', label: 'Pessoas', section: 'Gestao', icon: UserCog, gestorOnly: true },
  { href: '/admin/administracao', label: 'Administracao', section: 'Gestao', icon: Settings, gestorOnly: true },
  { href: '/admin/auditoria', label: 'Auditoria', section: 'Gestao', icon: ScrollText, gestorOnly: true },
  { href: '/admin/copilot', label: 'Copilot', section: 'Gestao', icon: Sparkles, gestorOnly: true },
]

const AUTH_FREE_PATHS = ['/login']
const SIDEBAR_STORAGE_KEY = 'cockpit:shell:sidebar-collapsed'

function isAuthFreePath(pathname: string) {
  return AUTH_FREE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function isLinkActive(pathname: string, link: ShellNavLink) {
  if (link.href === '/') return pathname === '/' || pathname.startsWith('/notas/')
  if (link.exact) return pathname === link.href
  return pathname === link.href || pathname.startsWith(`${link.href}/`)
}

function getVisibleLinks(userRole?: string | null) {
  const canUseAdmin = userRole === 'gestor'
  return NAV_LINKS.filter((link) => !link.gestorOnly || canUseAdmin)
}

function getActiveLink(pathname: string, links: ShellNavLink[]) {
  return links.find((link) => isLinkActive(pathname, link)) ?? links[0]
}

function getInitials(value?: string | null) {
  const parts = (value ?? 'CO')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return 'CO'
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function groupLinks(links: ShellNavLink[]) {
  return links.reduce<Record<string, ShellNavLink[]>>((acc, link) => {
    acc[link.section] = [...(acc[link.section] ?? []), link]
    return acc
  }, {})
}

function SidebarContent({
  pathname,
  links,
  collapsed,
  onNavigate,
}: {
  pathname: string
  links: ShellNavLink[]
  collapsed: boolean
  onNavigate?: () => void
}) {
  const groupedLinks = groupLinks(links)

  return (
    <nav aria-label="Navegacao principal" className={cn('space-y-5', collapsed && 'space-y-4')}>
      {Object.entries(groupedLinks).map(([section, sectionLinks]) => (
        <section key={section} className="space-y-1.5">
          {!collapsed ? (
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section}
            </p>
          ) : null}

          <div className={cn('space-y-1', collapsed && 'flex flex-col items-center')}>
            {sectionLinks.map((link) => {
              const Icon = link.icon
              const active = isLinkActive(pathname, link)

              return (
                <PrefetchLink
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? link.label : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'group relative flex h-10 items-center rounded-md border text-sm font-medium transition-colors',
                    collapsed ? 'w-10 justify-center px-0' : 'gap-3 px-3',
                    active
                      ? 'border-primary/25 bg-primary/10 text-primary shadow-sm'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  {active ? (
                    <span className={cn(
                      'absolute rounded-full bg-primary',
                      collapsed ? '-left-2 h-6 w-1' : 'left-1 h-5 w-1',
                    )} />
                  ) : null}
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed ? <span className="min-w-0 truncate">{link.shortLabel ?? link.label}</span> : null}
                  {collapsed ? (
                    <span className="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                      {link.label}
                    </span>
                  ) : null}
                </PrefetchLink>
              )
            })}
          </div>
        </section>
      ))}
    </nav>
  )
}

export function CockpitShell({ children, userName, userRole }: CockpitShellProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const links = useMemo(() => getVisibleLinks(userRole), [userRole])
  const activeLink = getActiveLink(pathname, links)
  const isViewer = userRole === 'viewer'
  const isOperacional = userRole === 'operacional'

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored === '1') setCollapsed(true)
  }, [])

  function handleCollapsedChange(next: boolean) {
    setCollapsed(next)
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0')
  }

  async function handleLogout() {
    await signOut({ redirectTo: '/login' })
  }

  if (isAuthFreePath(pathname)) {
    return <div className="min-h-screen bg-background">{children}</div>
  }

  if (isOperacional) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white shadow-sm">
            <Image src="/login-logo.png" alt="Cockpit" width={22} height={22} />
          </span>
          <span className="flex-1 truncate text-sm font-semibold tracking-tight">Cockpit</span>
          {userName && (
            <span className="max-w-[140px] truncate text-xs text-muted-foreground">{userName}</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleLogout}
            aria-label="Sair"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 border-r bg-background/95 shadow-[1px_0_0_rgba(15,23,42,0.02)] backdrop-blur lg:flex lg:flex-col',
            collapsed ? 'w-[4.5rem]' : 'w-64 xl:w-72',
          )}
        >
          <div className="flex h-14 items-center border-b px-3">
            <button
              type="button"
              onClick={() => handleCollapsedChange(!collapsed)}
              aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
              className={cn(
                'flex h-10 min-w-0 items-center rounded-md text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed ? 'w-10 justify-center' : 'w-full gap-2 px-1.5',
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white shadow-sm">
                <Image src="/login-logo.png" alt="Cockpit" width={22} height={22} />
              </span>
              {!collapsed ? <span className="truncate text-base font-semibold tracking-tight">Cockpit</span> : null}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarContent pathname={pathname} links={links} collapsed={collapsed} />
          </div>

          <div className="border-t p-3">
            {collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/50 text-xs font-semibold text-muted-foreground"
                  title={userName ?? 'Cockpit'}
                >
                  {getInitials(userName)}
                </span>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={handleLogout} aria-label="Sair">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {userName ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                      {getInitials(userName)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{userName}</p>
                      <p className="text-xs text-muted-foreground">{userRole === 'gestor' ? 'Gestor' : 'Admin'}</p>
                    </div>
                  </div>
                ) : null}
                <ThemeSelector className="w-full" />
                <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  Sair
                </Button>
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4 lg:px-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <LayoutDashboard className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-5">{activeLink?.label ?? 'Cockpit'}</p>
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  {activeLink?.section ?? 'Operação'}
                </p>
              </div>
            </div>

            <ThemeSelector className="hidden w-32 md:flex" />
            {userName && !isViewer ? (
              <span className="hidden max-w-44 truncate text-sm text-muted-foreground xl:inline">
                {userName}
              </span>
            ) : null}
            {userRole === 'gestor' ? (
              <span className="hidden items-center gap-1 rounded-full border bg-muted/60 px-2 py-1 text-[11px] font-medium text-muted-foreground md:inline-flex">
                <Shield className="h-3 w-3" />
                Gestor
              </span>
            ) : null}
            <Button type="button" variant="ghost" size="icon" onClick={handleLogout} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </header>

          <AppMainShell>{children}</AppMainShell>
        </div>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-full max-w-[320px] flex-col border-r bg-background shadow-xl outline-none">
            <div className="flex items-start justify-between gap-4 border-b px-4 py-4">
              <div className="space-y-1">
                <DialogTitle className="text-base">Cockpit</DialogTitle>
                <DialogDescription>Navegue entre os paineis operacionais.</DialogDescription>
              </div>
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Fechar menu">
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="border-b px-4 py-3">
              <ThemeSelector mobile />
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              <SidebarContent
                pathname={pathname}
                links={links}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>

            <div className="border-t p-3">
              <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Sair
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    </div>
  )
}
