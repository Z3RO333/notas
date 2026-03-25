'use client'

import { useEffect, useMemo, useState } from 'react'
import type { NotaStatusOperacional } from '@/lib/types/database'

interface NotaOperacionalBadgeProps {
  statusOperacional?: NotaStatusOperacional | null
  emGeracaoPorEmail?: string | null
  emGeracaoEm?: string | null
  ttlMinutos?: number | null
  numeroOrdemConfirmada?: string | null
}

function buildElapsedLabel(referenceIso: string | null): string | null {
  if (!referenceIso) return null
  const parsed = new Date(referenceIso)
  if (Number.isNaN(parsed.getTime())) return null
  const diffMinutes = Math.max(Math.floor((Date.now() - parsed.getTime()) / 60000), 0)
  if (diffMinutes < 60) return `${diffMinutes}m`
  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  if (hours < 24) return `${hours}h ${minutes}m`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return `${days}d ${remHours}h`
}

function humanizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const localPart = email.split('@')[0]
  if (!localPart) return email
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function NotaOperacionalBadge({
  statusOperacional,
  emGeracaoPorEmail,
  emGeracaoEm,
  ttlMinutos,
  numeroOrdemConfirmada,
}: NotaOperacionalBadgeProps) {
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [alertaVisible, setAlertaVisible] = useState(true)
  const [emGeracaoVisible, setEmGeracaoVisible] = useState(true)

  useEffect(() => {
    if (statusOperacional !== 'EM_GERACAO') return
    const ticker = setInterval(() => setNowTick(Date.now()), 60_000)

    // Ciclo: visível 5s → oculto 10s → repete
    const SHOW_MS = 5_000
    const HIDE_MS = 10_000
    let t1: ReturnType<typeof setTimeout>
    let t2: ReturnType<typeof setTimeout>
    function cycle() {
      setEmGeracaoVisible(true)
      t1 = setTimeout(() => {
        setEmGeracaoVisible(false)
        t2 = setTimeout(cycle, HIDE_MS)
      }, SHOW_MS)
    }
    cycle()

    return () => {
      clearInterval(ticker)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [statusOperacional])

  useEffect(() => {
    if (statusOperacional !== 'ALERTA') return

    // Ciclo: visível 5s → oculto 10s → repete
    const SHOW_MS = 5_000
    const HIDE_MS = 10_000
    let t1: ReturnType<typeof setTimeout>
    let t2: ReturnType<typeof setTimeout>
    function cycle() {
      setAlertaVisible(true)
      t1 = setTimeout(() => {
        setAlertaVisible(false)
        t2 = setTimeout(cycle, HIDE_MS)
      }, SHOW_MS)
    }
    cycle()

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [statusOperacional])

  const elapsed = useMemo(() => {
    if (statusOperacional !== 'EM_GERACAO') return null
    // nowTick está aqui apenas para forçar recomputo do tempo.
    void nowTick
    return buildElapsedLabel(emGeracaoEm ?? null)
  }, [emGeracaoEm, nowTick, statusOperacional])

  if (!statusOperacional || statusOperacional === 'PENDENTE') return null

  if (statusOperacional === 'EM_GERACAO') {
    const owner = humanizeEmail(emGeracaoPorEmail)
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 transition-opacity duration-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ${emGeracaoVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        {owner ? `Em geração por ${owner}` : 'Em geração'}
        {elapsed ? `· ${elapsed}` : ''}
      </span>
    )
  }

  if (statusOperacional === 'ALERTA') {
    const ttl = Math.max(Number(ttlMinutos ?? 60), 1)
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800 transition-opacity duration-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300 ${alertaVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        {`Aguardando confirmação > ${ttl} min`}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      {numeroOrdemConfirmada
        ? `Confirmada: ordem ${numeroOrdemConfirmada}`
        : 'Confirmada: virou ordem'}
    </span>
  )
}
