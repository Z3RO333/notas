import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { TopNav } from '@/components/layout/top-nav'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { AppProviders } from '@/app/providers'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { buildThemeBootstrapScript } from '@/lib/theme/theme'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Cockpit de Manutenção',
  description: 'Painel de ordens de manutenção',
}

function isDynamicServerUsageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as { digest?: string }).digest === 'DYNAMIC_SERVER_USAGE'
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let userName: string | null = null
  let userRole: string | null = null

  try {
    const currentAdminContext = await getCurrentAdminContext()
    userName = currentAdminContext.userName
    userRole = currentAdminContext.role
  } catch (error) {
    if (!isDynamicServerUsageError(error)) {
      console.error('RootLayout failed to load session context:', error)
    }
  }

  const themeBootstrapScript = buildThemeBootstrapScript()

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <AppProviders>
            <ToastProvider>
              <div className="min-h-screen bg-background">
                <TopNav userName={userName} userRole={userRole} />
                <main className="mx-auto max-w-screen-2xl px-6 py-6">
                  {children}
                </main>
              </div>
            </ToastProvider>
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  )
}
