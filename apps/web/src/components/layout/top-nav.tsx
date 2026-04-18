'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'
import { ClipboardList, ListChecks, Shield, ShoppingCart, Sparkles, LogOut, Menu, X } from 'lucide-react'
import { ThemeSelector } from '@/components/theme/theme-selector'
import { PrefetchLink } from '@/components/shared/prefetch-link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface TopNavProps {
  userName?: string | null
  userRole?: string | null
}

export function TopNav({ userName, userRole }: TopNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const isViewer = userRole === 'viewer'
  const homeHref = isViewer ? '/ordens' : '/'

  const links = [
    { href: '/', label: 'Painel de Notas', icon: ClipboardList },
    { href: '/ordens', label: 'Painel de Ordens', icon: ListChecks },
    { href: '/pedidos', label: 'Pedidos de Compra', icon: ShoppingCart },
    ...(userRole === 'gestor'
      ? [
          { href: '/admin', label: 'Admin', icon: Shield },
          { href: '/admin/copilot', label: 'Copilot', icon: Sparkles },
        ]
      : []),
  ]

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isLinkActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/notas/')
    if (href === '/admin') return pathname === '/admin' || (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/copilot'))
    return pathname.startsWith(href)
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-6">
        <PrefetchLink href={homeHref} className="mr-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
            <Image src="/login-logo.png" alt="Cockpit" width={22} height={22} />
          </div>
          <span className="text-lg font-bold tracking-tight">Cockpit</span>
        </PrefetchLink>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1">
          {links.map((link) => {
            const Icon = link.icon
            return (
              <PrefetchLink
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isLinkActive(link.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </PrefetchLink>
            )
          })}
        </nav>

        {/* Spacer on mobile */}
        <div className="flex-1 md:hidden" />

        <div className="flex items-center gap-3">
          <ThemeSelector className="hidden md:flex" />
          {userName && !isViewer && (
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {userName}
            </span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Sair"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sair</span>
          </button>

          {/* Hamburger — mobile only */}
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="md:hidden flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <nav className="md:hidden border-t bg-background px-4 pb-3 pt-2 space-y-1">
          <div className="mb-2 rounded-md border p-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Tema</p>
            <ThemeSelector mobile />
          </div>
          {links.map((link) => {
            const Icon = link.icon
            return (
              <PrefetchLink
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isLinkActive(link.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </PrefetchLink>
            )
          })}
        </nav>
      )}
    </header>
  )
}
