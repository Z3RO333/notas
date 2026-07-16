'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { mapRedirectErrorMessage } from '@/lib/auth/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const searchParams = useSearchParams()
  const redirectErrorCode = searchParams.get('error')

  useEffect(() => {
    const nextError = mapRedirectErrorMessage(redirectErrorCode)
    if (nextError) setError(nextError)
  }, [redirectErrorCode])

  async function handleMicrosoftSignIn() {
    setLoading(true)
    setError('')
    await signIn('microsoft-entra-id', { redirectTo: '/' })
  }

  return (
    <Card className="w-full max-w-sm animate-fade-in-up border-white/10 bg-background/92 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.34)] dark:bg-slate-950/55 dark:border-white/[0.06] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.5)]">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex items-center justify-center">
          <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] bg-gradient-to-b from-white/18 via-white/10 to-white/5 ring-1 ring-white/14 shadow-[0_20px_50px_rgba(2,6,23,0.45),inset_0_1px_0_rgba(255,255,255,0.24)] backdrop-blur-md">
            <div className="absolute inset-x-4 top-3 h-8 rounded-full bg-white/20 blur-xl" />
            <Image
              src="/login-logo.png"
              alt="Logo do cockpit"
              width={58}
              height={64}
              priority
              className="relative h-auto w-[58px] drop-shadow-[0_10px_18px_rgba(8,15,40,0.32)]"
            />
          </div>
        </div>
        <CardTitle className="text-xl">Cockpit de Manutenção</CardTitle>
        <CardDescription>Entre com sua conta Microsoft @bemol.com.br</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        <Button
          type="button"
          variant="gradient"
          className="w-full"
          disabled={loading}
          onClick={handleMicrosoftSignIn}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Entrando...
            </>
          ) : (
            'Entrar com Microsoft'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
