'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wrench, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function switchMode() {
    setMode((m) => (m === 'login' ? 'register' : 'login'))
    setError('')
    setConfirmPassword('')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      })

      if (authError) {
        setError(authError.message === 'Email not confirmed'
          ? 'Email nao confirmado. Tente cadastrar novamente.'
          : 'Email ou senha invalidos.')
        setLoading(false)
        return
      }

      window.location.href = '/api/auth/landing'
    } catch {
      setError('Erro inesperado. Tente novamente.')
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

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

      // Verifica se o email esta cadastrado na tabela de administradores
      const { data: admin, error: adminError } = await supabase
        .from('administradores')
        .select('id')
        .eq('email', trimmedEmail)
        .single()

      if (adminError || !admin) {
        setError('Email nao autorizado. Contate o gestor.')
        return
      }

      // Cria a conta no Supabase Auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      })

      if (signUpError) {
        setError(signUpError.message === 'User already registered'
          ? 'Este email ja possui conta. Use o login normal.'
          : signUpError.message)
        return
      }

      // Vincula o auth_user_id ao registro do administrador
      if (signUpData.user) {
        await supabase
          .from('administradores')
          .update({ auth_user_id: signUpData.user.id })
          .eq('id', admin.id)
      }

      // Se signUp ja retornou sessao, redireciona direto
      if (signUpData.session) {
        window.location.href = '/api/auth/landing'
        return
      }

      // Fallback: faz login com as credenciais recem-criadas
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (loginError) {
        setError('Conta criada, mas nao foi possivel entrar automaticamente. Tente fazer login.')
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

  const isLogin = mode === 'login'

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
              onChange={(e) => setEmail(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {!isLogin && (
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirmar Senha
              </label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isLogin ? 'Entrando...' : 'Cadastrando...'}
              </>
            ) : (
              isLogin ? 'Entrar' : 'Cadastrar'
            )}
          </Button>
        </form>
        <button
          type="button"
          onClick={switchMode}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {isLogin
            ? 'Primeiro acesso? Cadastre-se aqui'
            : 'Ja tem conta? Faca login'}
        </button>
      </CardContent>
    </Card>
  )
}
