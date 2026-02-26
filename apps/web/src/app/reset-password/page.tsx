'use client'

import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSearchParams } from 'next/navigation'

export default function ResetPasswordPage() {
  const searchParams = useSearchParams()
  const recoveryType = searchParams.get('type')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingFlow, setCheckingFlow] = useState(true)
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const supabase = createClient()
    if (recoveryType === 'recovery') {
      setIsRecoveryFlow(true)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryFlow(true)
      }
    })

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!session) {
          setError('Sessao de recuperacao expirada. Solicite um novo link de redefinicao.')
        }
      })
      .finally(() => {
        setCheckingFlow(false)
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [recoveryType])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')

    if (!isRecoveryFlow) {
      setError('Link de recuperacao invalido. Solicite um novo email de redefinicao.')
      return
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas nao coincidem.')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Sessao de recuperacao expirada. Solicite um novo link de redefinicao.')
        setLoading(false)
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        setError('Nao foi possivel atualizar a senha. Solicite um novo link e tente novamente.')
        setLoading(false)
        return
      }

      setNotice('Senha atualizada com sucesso. Redirecionando...')
      window.location.href = '/api/auth/landing'
    } catch {
      setError('Erro inesperado. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm items-center justify-center px-4">
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <ShieldCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl">Redefinir senha</CardTitle>
          <CardDescription>
            Defina uma nova senha para voltar a acessar o cockpit por login normal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checkingFlow ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Validando link...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Nova senha
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimo 6 caracteres"
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium">
                  Confirmar nova senha
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repita a nova senha"
                  required
                  minLength={6}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {notice && <p className="text-sm text-emerald-700">{notice}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Atualizar senha'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
