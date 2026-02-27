import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        nova: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
        em_andamento: 'border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300',
        encaminhada: 'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300',
        concluida: 'border-transparent bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
        cancelada: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
