'use client'

import { useEffect, useState } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import {
  mapLoginErrorMessage,
  mapRedirectErrorMessage,
  mapRegisterErrorMessage,
  normalizeEmail,
} from '@/lib/auth/shared'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const searchParams = useSearchParams()
  const redirectErrorCode = searchParams.get('error')

  const isLogin = mode === 'login'

  useEffect(() => {
    const nextError = mapRedirectErrorMessage(redirectErrorCode)
    if (nextError) {
      setError(nextError)
      setNotice('')
    }
  }, [redirectErrorCode])

  function switchMode() {
    setMode((current) => (current === 'login' ? 'register' : 'login'))
    setError('')
    setNotice('')
    setConfirmPassword('')
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      })

      if (authError) {
        setError(mapLoginErrorMessage(authError.message))
        setLoading(false)
        return
      }

      window.location.href = '/api/auth/landing'
    } catch {
      setError('Erro inesperado. Tente novamente.')
      setLoading(false)
    }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas nao coincidem.')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const trimmedEmail = normalizeEmail(email)
      const registerResponse = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          confirmPassword,
        }),
      })
      const registerPayload = (await registerResponse.json()) as {
        ok?: boolean
        code?: string
      }

      if (!registerResponse.ok || !registerPayload.ok) {
        setError(mapRegisterErrorMessage(registerPayload.code))
        if (registerPayload.code === 'ACCOUNT_ALREADY_ACTIVE') {
          setMode('login')
          setConfirmPassword('')
        }
        setLoading(false)
        return
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (loginError) {
        setError('Conta criada, mas nao foi possivel entrar agora. Use o login normal.')
        setNotice('')
        setMode('login')
        setConfirmPassword('')
        setLoading(false)
        return
      }

      window.location.href = '/api/auth/landing'
    } catch {
      setError('Erro inesperado. Tente novamente.')
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    setError('')
    setNotice('')

    const trimmedEmail = normalizeEmail(email)
    if (!trimmedEmail) {
      setError('Informe seu email para receber o link de redefinicao de senha.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const redirectTo = `${window.location.origin}/api/auth/callback`
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo,
      })

      if (resetError) {
        setError('Nao foi possivel enviar o email de redefinicao. Tente novamente.')
        setLoading(false)
        return
      }

      setNotice(
        'Link de redefinicao enviado. Abra o email, clique no link e defina uma nova senha.'
      )
      setLoading(false)
    } catch {
      setError('Erro inesperado. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
          <Wrench className="h-6 w-6 text-primary-foreground" />
        </div>
        <CardTitle className="text-xl">Cockpit de Manutencao</CardTitle>
        <CardDescription>
          {isLogin
            ? 'Entre com suas credenciais para acessar o sistema'
            : 'Primeiro acesso: crie sua senha para acessar o sistema'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="seu.email@bemol.com.br"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Senha
            </label>
            <Input
              id="password"
              type="password"
              placeholder={isLogin ? 'Digite sua senha' : 'Crie uma senha (min. 6 caracteres)'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </div>

          {!isLogin && (
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirmar senha
              </label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={6}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isLogin ? 'Entrando...' : 'Cadastrando...'}
              </>
            ) : isLogin ? (
              'Entrar'
            ) : (
              'Criar conta'
            )}
          </Button>
        </form>

        {isLogin && (
          <button
            type="button"
            onClick={handleResetPassword}
            className="mt-3 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            disabled={loading}
          >
            Esqueci minha senha
          </button>
        )}

        <button
          type="button"
          onClick={switchMode}
          className="mt-4 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {isLogin ? 'Primeiro acesso? Crie sua senha' : 'Ja tem conta? Faca login'}
        </button>
      </CardContent>
    </Card>
  )
}
