import { useEffect, useRef, useState } from 'react'
import type { PedidosWorkspaceFilters } from '@/lib/types/pedidos'

function syncFiltersToUrl(filters: PedidosWorkspaceFilters) {
  const params = new URLSearchParams(window.location.search)
  const setOrDelete = (key: string, value: string | null) => {
    if (!value) { params.delete(key); return }
    params.set(key, value)
  }
  setOrDelete('q', filters.q || null)
  setOrDelete('status', filters.status !== 'all' ? filters.status : null)
  setOrDelete('adminId', filters.adminId !== 'all' ? filters.adminId : null)
  params.set('ano', filters.anoExtracao ?? 'all')
  setOrDelete('mes', filters.mesExtracao)
  setOrDelete('carteiraEspecial', filters.carteiraEspecial ? '1' : null)
  const query = params.toString()
  window.history.replaceState({}, '', query ? `?${query}` : window.location.pathname)
}

interface UsePedidosFiltersOptions {
  initialFilters: PedidosWorkspaceFilters
}

export function usePedidosFilters({ initialFilters }: UsePedidosFiltersOptions) {
  const [filters, setFilters] = useState<PedidosWorkspaceFilters>(initialFilters)
  const [searchInput, setSearchInput] = useState(initialFilters.q)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const clean = searchInput.trim()
      setFilters((prev) => (prev.q === clean ? prev : { ...prev, q: clean }))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    function handleSlashFocus(event: KeyboardEvent) {
      if (event.key !== '/') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName.toLowerCase()
        if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) return
      }
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('keydown', handleSlashFocus)
    return () => window.removeEventListener('keydown', handleSlashFocus)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    syncFiltersToUrl(filters)
  }, [filters])

  return { filters, setFilters, searchInput, setSearchInput, searchInputRef }
}
