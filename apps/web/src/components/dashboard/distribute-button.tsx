'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { distribuirNotasManual } from '@/lib/actions/nota-actions'

export function DistributeButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleDistribute() {
    setLoading(true)
    setMessage('')
    try {
      const count = await distribuirNotasManual()
      setMessage(`${count} nota${count !== 1 ? 's' : ''} distribuida${count !== 1 ? 's' : ''}`)
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao distribuir')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleDistribute} disabled={loading} variant="outline">
        <Shuffle className="mr-2 h-4 w-4" />
        {loading ? 'Distribuindo...' : 'Distribuir Manualmente'}
      </Button>
      {message && <span className="text-sm text-muted-foreground">{message}</span>}
    </div>
  )
}
