import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { Permission } from '@/config/permissions'
import { useCan } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

/** Standard page title block: title, description and contextual actions. */
export function PageHeader({ title, description, actions, meta, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold leading-tight tracking-tight">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Padded page body. Use inside every non-full-bleed route. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1760px] p-3 sm:p-4 lg:p-5', className)}>{children}</div>
}

/** Panel — the base surface for every card-like region. */
export function Panel({ title, description, actions, children, className, bodyClassName, flush }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string; flush?: boolean }) {
  return (
    <section className={cn('panel flex min-w-0 flex-col', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-3.5 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold leading-tight">{title}</h2>
            {description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', !flush && 'p-3.5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Label/value grid for detail views. */
export function DetailGrid({ items, columns = 2, className }: { items: { label: string; value: ReactNode; hidden?: boolean }[]; columns?: 1 | 2 | 3 | 4; className?: string }) {
  const cols = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }[columns]
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols, className)}>
      {items.filter((i) => !i.hidden).map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="label-xs mb-0.5">{i.label}</dt>
          <dd className="truncate text-[13px] text-foreground">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface TimelineItem {
  id: string
  title: ReactNode
  description?: ReactNode
  time?: ReactNode
  done?: boolean
  tone?: 'default' | 'danger' | 'warning' | 'primary'
  icon?: ReactNode
}

/** Vertical timeline (shipment milestones, trip events, activity history). */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-0', className)}>
      {items.map((it, i) => {
        const done = it.done ?? true
        return (
          <li key={it.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < items.length - 1 && <span className={cn('absolute left-[9px] top-5 h-[calc(100%-12px)] w-px', done ? 'bg-primary/40' : 'bg-border')} aria-hidden />}
            <span
              className={cn(
                'relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border text-[10px]',
                it.tone === 'danger' ? 'border-danger bg-danger/15 text-danger' : it.tone === 'warning' ? 'border-warning bg-warning/15 text-warning' : done ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-card text-subtle-foreground',
              )}
            >
              {it.icon ?? (done ? <Check className="size-3" strokeWidth={3} /> : null)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={cn('text-[13px] font-medium', !done && 'text-muted-foreground')}>{it.title}</p>
                {it.time && <span className="num text-xs text-subtle-foreground">{it.time}</span>}
              </div>
              {it.description && <p className="mt-0.5 text-xs text-muted-foreground">{it.description}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Renders children only when the signed-in role holds the permission(s). */
export function Can({ perm, children, fallback = null }: { perm: Permission | Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const ok = useCan(perm)
  return <>{ok ? children : fallback}</>
}
