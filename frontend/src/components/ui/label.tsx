import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from '../../lib/utils'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-foreground/80 flex items-center gap-2 text-[11px] leading-none font-semibold tracking-[0.12em] uppercase select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)}
      {...props}
    />
  )
}

export { Label }
