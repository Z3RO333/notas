'use client'

import type { AnchorHTMLAttributes, FocusEvent, MouseEvent, ReactNode, TouchEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface PrefetchLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children: ReactNode
}

export function PrefetchLink({
  href,
  children,
  onMouseEnter,
  onTouchStart,
  onFocus,
  ...props
}: PrefetchLinkProps) {
  const router = useRouter()

  function prefetchRoute() {
    router.prefetch(href)
  }

  function handleMouseEnter(event: MouseEvent<HTMLAnchorElement>) {
    onMouseEnter?.(event)
    prefetchRoute()
  }

  function handleTouchStart(event: TouchEvent<HTMLAnchorElement>) {
    onTouchStart?.(event)
    prefetchRoute()
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event)
    prefetchRoute()
  }

  return (
    <Link
      href={href}
      prefetch
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      onFocus={handleFocus}
      {...props}
    >
      {children}
    </Link>
  )
}
