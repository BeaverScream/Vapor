import * as React from 'react'

import { cn } from '../../lib/utils'

interface InputProps extends React.ComponentProps<'input'> {
  /** Decorative glyph rendered inside the field's leading edge (e.g. `#`, key icon). */
  adornment?: React.ReactNode
}

function Input({ className, type, adornment, ...props }: InputProps) {
  const field = (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input bg-input-fill flex h-12 w-full min-w-0 rounded-full border px-4 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
        adornment ? 'pl-11' : undefined,
        className,
      )}
      {...props}
    />
  )

  if (!adornment) {
    return field
  }

  return (
    <div className="relative w-full">
      <span
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 flex -translate-y-1/2 items-center [&_svg]:size-4"
      >
        {adornment}
      </span>
      {field}
    </div>
  )
}

export { Input }
