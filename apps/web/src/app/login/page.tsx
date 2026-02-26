'use client'

import { useState } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

function mapLoginErrorMessage(rawMessage: string): string {
  const message = rawMessage.toLowerCase()
  if (message.includes('email not confirmed')) {
    return 'Email nao confirmado. Clique no link de confirmacao enviado para sua caixa de entrada.'
  }
  if (message.includes('invalid login credentials')) {
    return 'Email ou senha invalidos. Se voce pediu recuperacao, abra o link do email e redefina sua senha.'
  }
  return 'Nao foi possivel autenticar agora. Tente novamente.'
}

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isLogin = mode === 'login'

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
        email: email.toLowerCase().trim(),
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
      const trimmedEmail = email.toLowerCase().trim()

      const { data: admin, error: adminError } = await supabase
        .from('administradores')
        .select('id')
        .eq('email', trimmedEmail)
        .single()

      if (adminError || !admin) {
        setError('Email nao autorizado. Contate o gestor.')
        setLoading(false)
        return
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      })

      if (signUpError) {
        setError(
          signUpError.message === 'User already registered'
            ? 'Este email ja possui conta. Use o login normal.'
            : signUpError.message
        )
        setLoading(false)
        return
      }

      if (signUpData.user) {
        await supabase
          .from('administradores')
          .update({ auth_user_id: signUpData.user.id })
          .eq('id', admin.id)
      }

      if (signUpData.session) {
        window.location.href = '/api/auth/landing'
        return
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (loginError) {
        setError(
          'Conta criada, mas sem login automatico. Confirme o email e depois faca login.'
        )
        setMode('login')
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

    const trimmedEmail = email.toLowerCase().trim()
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
            : 'Crie sua senha para acessar o sistema'}
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
          {notice && <p className="text-sm text-emerald-700">{notice}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isLogin ? 'Entrando...' : 'Cadastrando...'}
              </>
            ) : isLogin ? (
              'Entrar'
            ) : (
              'Cadastrar'
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
          {isLogin ? 'Primeiro acesso? Cadastre-se aqui' : 'Ja tem conta? Faca login'}
        </button>
      </CardContent>
    </Card>
  )
}
