import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tone } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/form-controls'

export function ViewAll({ to, children = 'View all', onClick }: { to?: string; children?: ReactNode; onClick?: () => void }) {
  if (!to)
    return (
      <Button variant="ghost" size="xs" onClick={onClick} className="text-muted-foreground">
        {children}
        <ArrowRight />
      </Button>
    )
  return (
    <Button asChild variant="ghost" size="xs" className="text-muted-foreground">
      <Link to={to}>
        {children}
        <ArrowRight />
      </Link>
    </Button>
  )
}

export const TONE_BUBBLE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  info: 'bg-info/12 text-info',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
  outline: 'bg-surface-3 text-foreground',
}

export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y divide-border/70', className)}>{children}</ul>
}

/** Standard two-line list row: tone icon, title + meta, right-aligned aside. */
export function ListRow({
  icon: Icon, tone = 'neutral', title, meta, aside, unread, onClick, className,
}: {
  icon?: LucideIcon
  tone?: Tone
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  unread?: boolean
  onClick?: () => void
  className?: string
}) {
  const inner = (
    <>
      {Icon && (
        <span className={cn('mt-px flex size-7 shrink-0 items-center justify-center rounded-full', TONE_BUBBLE[tone])}>
          <Icon className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-center gap-1.5 text-[13px] leading-tight', unread ? 'font-medium text-foreground' : 'text-foreground')}>
          <span className="min-w-0 truncate">{title}</span>
          {unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </div>
        {meta && <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] leading-tight text-muted-foreground">{meta}</div>}
      </div>
      {aside && <div className="flex shrink-0 flex-col items-end gap-1 text-right">{aside}</div>}
    </>
  )
  const base = cn('flex items-start gap-2.5 px-3.5 py-2', className)
  if (onClick)
    return (
      <li>
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClick()
            }
          }}
          className={cn(base, 'cursor-pointer outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50')}
        >
          {inner}
        </div>
      </li>
    )
  return <li className={base}>{inner}</li>
}

export function PanelEmpty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
      <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-success/12 text-success">
        <Icon className="size-4.5" />
      </div>
      <p className="text-[13px] font-medium">{title}</p>
      {description && <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/70">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Compact stat chip used in chart headers: "Avg 58.2%". */
export function MiniStat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="min-w-0">
      <div className="label-xs truncate">{label}</div>
      <div className={cn('num text-[15px] font-semibold leading-tight', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger')}>{value}</div>
    </div>
  )
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">{children}</div>
}
