import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { TopNav } from '@/components/layout/top-nav'
import { ToastProvider } from '@/components/ui/toast'
import { createClient } from '@/lib/supabase/server'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Cockpit de Manutencao',
  description: 'Painel de ordens de manutencao',
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
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError) {
      console.error('RootLayout auth.getUser failed:', userError.message)
    }

    if (user?.email) {
      const { data: admin, error: adminError } = await supabase
        .from('administradores')
        .select('nome, role')
        .eq('email', user.email)
        .maybeSingle()

      if (adminError) {
        console.error('RootLayout administradores query failed:', adminError.message)
      }

      userName = admin?.nome ?? user.email
      userRole = admin?.role ?? null
    }
  } catch (error) {
    if (!isDynamicServerUsageError(error)) {
      console.error('RootLayout failed to load session context:', error)
    }
  }

  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <ToastProvider>
          <div className="min-h-screen bg-background">
            <TopNav userName={userName} userRole={userRole} />
            <main className="mx-auto max-w-7xl px-6 py-6">
              {children}
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  )
}
