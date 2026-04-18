'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface AppMainShellProps {
  children: React.ReactNode
}

export function AppMainShell({ children }: AppMainShellProps) {
  const pathname = usePathname()
  const isAdminShell = pathname === '/admin' || pathname.startsWith('/admin/')

  return (
    <main
      className={cn(
        'min-w-0',
        isAdminShell
          ? 'w-full py-0'
          : 'mx-auto w-full max-w-screen-2xl px-6 py-6',
      )}
    >
      {children}
    </main>
  )
}
