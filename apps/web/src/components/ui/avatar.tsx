import Image from 'next/image'
import { cn } from '@/lib/utils'

interface AvatarProps {
  src: string | null | undefined
  nome: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
}

const pixelMap = {
  sm: 32,
  md: 40,
  lg: 56,
}

function getInitials(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export function Avatar({ src, nome, size = 'md', className }: AvatarProps) {
  const sizeClass = sizeMap[size]
  const px = pixelMap[size]

  if (src) {
    return (
      <div className={cn('relative overflow-hidden rounded-full', sizeClass, className)}>
        <Image
          src={src}
          alt={nome}
          width={px}
          height={px}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground',
        sizeClass,
        className
      )}
    >
      {getInitials(nome)}
    </div>
  )
}
