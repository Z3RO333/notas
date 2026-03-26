'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Banknote,
  BarChart3,
  BarChartBig,
  ChevronLeft,
  ChevronRight,
  HardHat,
  LineChart,
  ScrollText,
  Settings,
  ShieldAlert,
  UserCog,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const navRef = useRef<HTMLElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const node = navRef.current
    if (!node) return

    const maxScrollLeft = node.scrollWidth - node.clientWidth
    setCanScrollLeft(node.scrollLeft > 4)
    setCanScrollRight(maxScrollLeft - node.scrollLeft > 4)
  }, [])

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const node = navRef.current
    if (!node) return

    const amount = Math.max(node.clientWidth * 0.75, 220)
    node.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    })
  }, [])

  useEffect(() => {
    const node = navRef.current
    if (!node) return

    updateScrollState()

    const handleScroll = () => updateScrollState()
    const handleResize = () => updateScrollState()

    node.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)

    return () => {
      node.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
    }
  }, [updateScrollState])

  useEffect(() => {
    const node = navRef.current
    if (!node) return

    const activeLink = node.querySelector<HTMLAnchorElement>('[data-active="true"]')
    activeLink?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })

    const raf = window.requestAnimationFrame(() => updateScrollState())
    return () => window.cancelAnimationFrame(raf)
  }, [pathname, updateScrollState])

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-6 border-b bg-background/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background/95 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background/95 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 flex items-center pl-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Rolar abas para a esquerda"
            onClick={() => scrollTabs('left')}
            className={cn(
              'pointer-events-auto h-8 w-8 rounded-full border-border/70 bg-background/85 shadow-sm backdrop-blur transition-opacity',
              canScrollLeft ? 'opacity-100' : 'opacity-0',
            )}
            disabled={!canScrollLeft}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center pr-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Rolar abas para a direita"
            onClick={() => scrollTabs('right')}
            className={cn(
              'pointer-events-auto h-8 w-8 rounded-full border-border/70 bg-background/85 shadow-sm backdrop-blur transition-opacity',
              canScrollRight ? 'opacity-100' : 'opacity-0',
            )}
            disabled={!canScrollRight}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <nav
          ref={navRef}
          onWheel={(event) => {
            const node = navRef.current
            if (!node) return

            const horizontalDelta = Math.abs(event.deltaX)
            const verticalDelta = Math.abs(event.deltaY)
            const hasOverflow = node.scrollWidth > node.clientWidth + 4

            if (!hasOverflow || verticalDelta <= horizontalDelta) return

            node.scrollBy({ left: event.deltaY, behavior: 'auto' })
            event.preventDefault()
          }}
          className="no-scrollbar flex snap-x gap-2 overflow-x-auto scroll-smooth px-10 pb-1 [overscroll-behavior-x:contain]"
        >
          {links.map((link) => {
            const Icon = link.icon
            const isActive = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href)

            return (
              <Link
                key={link.href}
                href={link.href}
                data-active={isActive ? 'true' : 'false'}
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
