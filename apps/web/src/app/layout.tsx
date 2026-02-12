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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let userName: string | null = null
  let userRole: string | null = null

  if (user?.email) {
    const { data: admin } = await supabase
      .from('administradores')
      .select('nome, role')
      .eq('email', user.email)
      .single()

    userName = admin?.nome ?? user.email
    userRole = admin?.role ?? null
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
