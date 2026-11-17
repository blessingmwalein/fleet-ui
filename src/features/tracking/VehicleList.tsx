import * as React from 'react'
import { PanelLeftClose, Search, X } from 'lucide-react'
import type { LiveState } from '@/types'
import { LIVE_STATE } from '@/config/status'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { Tooltip } from '@/components/ui/overlays'
import { CategoryIcon, Plate } from '@/components/shared/Status'
import { EmptyState } from '@/components/shared/EmptyState'
import { STATE_ORDER, type TrackRow } from './useTrackingRows'

const STATE_HEX: Record<LiveState, string> = { moving: '#34d17a', idle: '#f2a93b', stopped: '#6b9bf2', maintenance: '#9b8afb', offline: '#7d8794' }

export function Chip({ active, onClick, color, children, count }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40', active ? 'border-primary/40 bg-primary/12 text-foreground' : 'border-border bg-surface-2/60 text-muted-foreground hover:text-foreground')}
    >
      {color && <span className="size-1.5 rounded-full" style={{ background: color }} />}
      {children}
      <span className="num text-subtle-foreground">{count}</span>
    </button>
  )
}

export function VehicleList({
  rows, counts, selectedId, onSelect, statusFilter, onStatusFilter, query, onQuery, onCollapse,
}: {
  rows: TrackRow[]
  counts: Record<LiveState | 'all', number>
  selectedId: string | null
  onSelect: (id: string) => void
  statusFilter: Set<LiveState>
  onStatusFilter: (s: Set<LiveState>) => void
  query: string
  onQuery: (q: string) => void
  onCollapse?: () => void
}) {
  const all = statusFilter.size === STATE_ORDER.length
  const selectedRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 pb-2.5 pt-3">
        <div>
          <h1 className="text-[15px] font-semibold leading-tight">Live tracking</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="num font-medium text-foreground">{counts.moving}</span> moving · <span className="num">{counts.all}</span> vehicles
          </p>
        </div>
        {onCollapse && (
          <Tooltip content="Hide vehicle list">
            <Button variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Hide vehicle list"><PanelLeftClose /></Button>
          </Tooltip>
        )}
      </div>

      <div className="space-y-2 border-b border-border p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search plate, driver, model…" className="pl-8 pr-7" aria-label="Search vehicles" />
          {query && (
            <button type="button" onClick={() => onQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground" aria-label="Clear search"><X className="size-3.5" /></button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Chip active={all} onClick={() => onStatusFilter(new Set(STATE_ORDER))} count={counts.all}>All</Chip>
          {STATE_ORDER.map((s) => (
            <Chip key={s} active={!all && statusFilter.size === 1 && statusFilter.has(s)} onClick={() => onStatusFilter(new Set([s]))} color={STATE_HEX[s]} count={counts[s]}>
              {LIVE_STATE[s].label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Vehicles">
        {rows.length === 0 ? (
          <EmptyState compact title="No vehicles match" description="Try another search or status filter." />
        ) : (
          rows.map((r) => {
            const active = r.id === selectedId
            return (
              <button
                key={r.id}
                ref={active ? selectedRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(r.id)}
                className={cn('relative flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50', active && 'bg-primary/8 hover:bg-primary/10')}
              >
                {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm" style={{ background: STATE_HEX[r.state], opacity: r.state === 'offline' ? 0.7 : 1 }}>
                  <CategoryIcon category={r.vehicle.category} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <Plate>{r.reg}</Plate>
                    <span className={cn('num text-xs font-medium', r.state === 'moving' ? 'text-success' : 'text-subtle-foreground')}>
                      {r.state === 'moving' ? `${r.speed} km/h` : LIVE_STATE[r.state].label}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.model} · {r.driverName}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-3">
                      <span className={cn('block h-full rounded-full', r.fuel < 15 ? 'bg-danger' : r.fuel < 30 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(3, r.fuel)}%` }} />
                    </span>
                    <span className="num text-[10.5px] text-subtle-foreground">{Math.round(r.fuel)}%</span>
                    <span className="truncate text-[10.5px] text-subtle-foreground">{r.location.split(' · ')[0]}</span>
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
