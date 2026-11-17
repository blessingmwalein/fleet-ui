import { Star } from 'lucide-react'
import type { WorkOrder } from '@/types'
import { Badge } from '@/components/ui/display'
import { Plate } from '@/components/shared/Status'
import { cn } from '@/lib/utils'
import { SCHEDULE_STATE, TYPE_COLOR, type ScheduleState } from '../lib/maintenance'
import { WORKORDER_TYPE } from '@/config/status'

/** 5-star rating with fractional fill. */
export function Stars({ value, showValue = true, className }: { value: number; showValue?: boolean; className?: string }) {
  const pct = Math.max(0, Math.min(5, value)) / 5
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <span className="relative inline-flex">
        <span className="flex text-border-strong">
          {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="size-3.5 shrink-0" />)}
        </span>
        <span className="absolute inset-y-0 left-0 flex overflow-hidden text-warning" style={{ width: `${pct * 100}%` }}>
          {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="size-3.5 shrink-0 fill-current" />)}
        </span>
      </span>
      {showValue && <span className="num text-xs font-medium">{value.toFixed(1)}</span>}
    </span>
  )
}

export function ScheduleBadge({ state }: { state: ScheduleState }) {
  const m = SCHEDULE_STATE[state]
  return <Badge tone={m.tone}>{m.label}</Badge>
}

/** Interval-consumed bar for service schedules. */
export function UsageBar({ pct, state, className }: { pct: number; state: ScheduleState; className?: string }) {
  const tone = state === 'overdue' ? 'bg-danger' : state === 'due_soon' ? 'bg-warning' : 'bg-primary'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="num w-9 shrink-0 text-right text-xs text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  )
}

/** Small coloured square + label for a work-order type. */
export function TypeTag({ type }: { type: WorkOrder['type'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span className="size-2 shrink-0 rounded-[3px]" style={{ background: TYPE_COLOR[type] }} />
      {WORKORDER_TYPE[type]}
    </span>
  )
}

/** Plate + make/model on a second line, for table cells. */
export function VehicleCell({ reg, name }: { reg: string; name?: string }) {
  return (
    <div className="min-w-0 leading-tight">
      <Plate>{reg}</Plate>
      {name && <div className="truncate text-xs text-muted-foreground">{name}</div>}
    </div>
  )
}
