import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'neutral'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-primary/15 text-primary',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  error: 'bg-destructive/15 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
}

function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  )
}

export { Badge, type BadgeVariant }
