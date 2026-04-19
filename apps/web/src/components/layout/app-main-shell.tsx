'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface AppMainShellProps {
  children: React.ReactNode
}

const OPERATIONAL_PATHS = ['/', '/ordens', '/pedidos']

function isOperationalPath(pathname: string) {
  return OPERATIONAL_PATHS.includes(pathname)
}

export function AppMainShell({ children }: AppMainShellProps) {
  const pathname = usePathname()
  const isAdminShell = pathname === '/admin' || pathname.startsWith('/admin/')
  const isOperationalShell = isOperationalPath(pathname)

  return (
    <main
      className={cn(
        'min-w-0',
        isAdminShell
          ? 'w-full py-0'
          : isOperationalShell
            ? 'w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10'
            : 'mx-auto w-full max-w-screen-2xl px-6 py-6',
      )}
    >
      {children}
    </main>
  )
}
