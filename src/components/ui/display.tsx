import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, hueFromString, initials } from '@/lib/utils'

/* ----------------------------- Badge ----------------------------- */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-3 text-muted-foreground',
        primary: 'border-primary/25 bg-primary/12 text-primary',
        success: 'border-success/25 bg-success/12 text-success',
        info: 'border-info/25 bg-info/12 text-info',
        warning: 'border-warning/30 bg-warning/12 text-warning',
        danger: 'border-danger/30 bg-danger/12 text-danger',
        outline: 'border-border-strong bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)
export type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export function Badge({ className, tone, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}

/* ----------------------------- Avatar (initials) ----------------------------- */
export function Avatar({ name, size = 28, className, src }: { name: string; size?: number; className?: string; src?: string }) {
  const hue = hueFromString(name)
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        background: `oklch(0.42 0.07 ${hue})`,
        color: `oklch(0.95 0.03 ${hue})`,
      }}
      aria-label={name}
    >
      {src ? <img src={src} alt={name} className="size-full object-cover" /> : initials(name)}
    </span>
  )
}

/* ----------------------------- Status dot ----------------------------- */
const dotTone: Record<Tone, string> = {
  neutral: 'bg-subtle-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  outline: 'bg-foreground',
}

export function StatusDot({ tone = 'neutral', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse && <span className={cn('absolute inset-0 rounded-full animate-pulse-ring', dotTone[tone])} />}
      <span className={cn('relative inline-block size-2 rounded-full', dotTone[tone])} />
    </span>
  )
}
