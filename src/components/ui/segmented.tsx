import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

/** Compact segmented control (radio group) — used for chart granularity, view modes, filters. */
export function Segmented<T extends string>({
  options, value, onChange, size = 'sm', className, 'aria-label': ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'xs' | 'sm' | 'md'
  className?: string
  'aria-label'?: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50',
              size === 'xs' ? 'h-5 px-1.5 text-[11px]' : size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
              active ? 'bg-card text-foreground shadow-xs ring-1 ring-border-strong' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
