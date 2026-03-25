import { useEffect, useRef, useState } from 'react'
import type { OrdersWorkspaceFilters } from '@/lib/types/database'

export function sanitizeText(value: string): string {
  return value.trim()
}

function syncFiltersToUrl(filters: OrdersWorkspaceFilters) {
  const params = new URLSearchParams(window.location.search)
  const setOrDelete = (key: string, value: string | null) => {
    if (!value) {
      params.delete(key)
      return
    }
    params.set(key, value)
  }

  setOrDelete('periodMode', filters.periodMode !== 'all' ? filters.periodMode : null)
  setOrDelete('year', filters.year ? String(filters.year) : null)
  setOrDelete('month', filters.month ? String(filters.month) : null)
  setOrDelete('startDate', filters.startDate)
  setOrDelete('endDate', filters.endDate)
  setOrDelete('q', filters.q || null)
  setOrDelete('status', filters.status && filters.status !== 'ativas' ? filters.status : null)
  setOrDelete('responsavel', filters.responsavel && filters.responsavel !== 'todos' ? filters.responsavel : null)
  setOrDelete('unidade', filters.unidade || null)
  setOrDelete('prioridade', filters.prioridade && filters.prioridade !== 'todas' ? filters.prioridade : null)
  setOrDelete('tipoOrdem', filters.tipoOrdem || null)

  const query = params.toString()
  window.history.replaceState({}, '', query ? `?${query}` : window.location.pathname)
}

interface UseOrdersFiltersOptions {
  initialFilters: OrdersWorkspaceFilters
  canViewGlobal: boolean
}

export function useOrdersFilters({ initialFilters, canViewGlobal }: UseOrdersFiltersOptions) {
  const [filters, setFilters] = useState<OrdersWorkspaceFilters>(initialFilters)
  const [searchInput, setSearchInput] = useState(initialFilters.q)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const pendingSearchEnterActionRef = useRef(false)
  const isPrivateScope = !canViewGlobal

  // Debounce search input → filters.q
  useEffect(() => {
    const timer = setTimeout(() => {
      const clean = sanitizeText(searchInput)
      setFilters((prev) => (prev.q === clean ? prev : { ...prev, q: clean }))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // '/' keyboard shortcut focuses search input
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

  // Sync filters → URL
  useEffect(() => {
    if (typeof window === 'undefined') return
    syncFiltersToUrl(filters)
  }, [filters])

  // Guard: non-global users can't filter by responsavel
  useEffect(() => {
    if (!isPrivateScope) return
    if (!filters.responsavel || filters.responsavel === 'todos') return
    setFilters((prev) => (prev.responsavel === 'todos' ? prev : { ...prev, responsavel: 'todos' }))
  }, [isPrivateScope, filters.responsavel])

  return { filters, setFilters, searchInput, setSearchInput, searchInputRef, pendingSearchEnterActionRef }
}
