import type { ReactNode } from 'react'
import { Status } from '@/components/shared/Status'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import type { ServiceInfo, VehicleStatusKey } from './lib'

/** Live state badge with administrative-status fallback. */
export function VehicleStatusBadge({ statusKey, className }: { statusKey: VehicleStatusKey; className?: string }) {
  if (statusKey === 'active' || statusKey === 'out_of_service') return <Status kind="vehicle" value={statusKey} className={className} />
  return <Status kind="live" value={statusKey} className={className} />
}

export function fuelTone(pct: number) {
  return pct < 15 ? 'bg-danger' : pct < 30 ? 'bg-warning' : 'bg-primary'
}

/** Compact fuel gauge: bar + percentage. */
export function FuelBar({ pct, className, showLabel = true }: { pct: number; className?: string; showLabel?: boolean }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div className={cn('flex items-center gap-2', className)} title={`Fuel ${Math.round(p)}%`}>
      <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-[width] duration-700', fuelTone(p))} style={{ width: `${p}%` }} />
      </div>
      {showLabel && <span className={cn('num w-9 text-xs', p < 15 ? 'font-medium text-danger' : 'text-muted-foreground')}>{Math.round(p)}%</span>}
    </div>
  )
}

/** Next-service cell: date with the task underneath, red when overdue, amber when due soon. */
export function NextServiceCell({ info }: { info: ServiceInfo }) {
  if (!info.schedule || info.dueTs === null) return <span className="text-subtle-foreground">—</span>
  return (
    <div className="min-w-0 leading-tight">
      <div className={cn('num truncate text-[13px]', info.overdue ? 'font-medium text-danger' : info.state === 'due_soon' ? 'text-warning' : 'text-foreground')}>
        {fmtDate(info.dueTs, 'dd MMM yyyy')}
        {info.overdue && <span className="ml-1.5 text-[11px] font-medium uppercase tracking-wide">Overdue</span>}
      </div>
      <div className="truncate text-[11px] text-subtle-foreground">{info.schedule.task}</div>
    </div>
  )
}

/** Small label + value pair used inside panels. */
export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="label-xs mb-0.5">{label}</div>
      <div className="truncate text-[13px] font-medium">{value}</div>
      {sub && <div className="truncate text-[11px] text-subtle-foreground">{sub}</div>}
    </div>
  )
}

/** Horizontal progress bar used for trip progress & health score. */
export function ProgressBar({ pct, tone = 'primary', className }: { pct: number; tone?: 'primary' | 'warning' | 'danger' | 'info'; className?: string }) {
  const toneCls = { primary: 'bg-primary', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info' }[tone]
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-700', toneCls)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}
