'use client'

import { useEffect, useState, type RefObject } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface BackToTopButtonProps {
  scrollContainerRef?: RefObject<HTMLElement | null>
  threshold?: number
}

export function BackToTopButton({ scrollContainerRef, threshold = 800 }: BackToTopButtonProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const container = scrollContainerRef?.current
    const target: HTMLElement | Window = container ?? window
    const isWindow = target === window

    function onScroll() {
      const scrollTop = isWindow
        ? window.scrollY
        : (target as HTMLElement).scrollTop
      setVisible(scrollTop > threshold)
    }

    onScroll()
    target.addEventListener('scroll', onScroll as EventListener, { passive: true } as AddEventListenerOptions)
    return () => target.removeEventListener('scroll', onScroll as EventListener)
  }, [scrollContainerRef, threshold])

  function handleClick() {
    const container = scrollContainerRef?.current
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <Button
      type="button"
      onClick={handleClick}
      aria-label="Voltar ao topo"
      className={cn(
        "fixed bottom-6 right-6 z-50 h-10 w-10 rounded-full p-0 shadow-lg transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  )
}
