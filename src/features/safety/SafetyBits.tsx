import { Fragment, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Car, CircleHelp, CornerUpRight, Flame, Gauge, HeartPulse, Lock, Moon, OctagonX, PackageX, ShieldAlert, Siren, Smartphone, Timer, TriangleAlert, Truck, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import type { Incident, IncidentType, SafetyEvent, SafetyEventType } from '@/types'
import { useDb } from '@/store/db'
import { useBranchScope } from '@/hooks/useFilters'
import { useById } from '@/hooks/useLookup'
import { Badge, StatusDot } from '@/components/ui/display'
import { Tooltip } from '@/components/ui/overlays'
import { Plate } from '@/components/shared/Status'
import { DriverLink, VehicleLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { SAFETY_EVENT_TYPE } from '@/config/status'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DAY_LABELS, EVENT_COLOR, scoreTone, toneVar, weekHeat } from './safety'
import { useNow } from './useSafetyData'

export const EVENT_ICON: Record<SafetyEventType, LucideIcon> = {
  speeding: Gauge, harsh_braking: OctagonX, harsh_acceleration: Zap, harsh_cornering: CornerUpRight, fatigue: Moon, seatbelt: ShieldAlert, phone_use: Smartphone, idling: Timer,
}

export const INCIDENT_ICON: Record<IncidentType, LucideIcon> = {
  collision: Car, rollover: Truck, theft: Lock, breakdown: Wrench, cargo_damage: PackageX, near_miss: TriangleAlert, injury: HeartPulse, fire: Flame, hijack: Siren, other: CircleHelp,
}

/** Icon tile tinted with the event type's chart colour. */
export function EventIcon({ type, size = 'md' }: { type: SafetyEventType; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = EVENT_ICON[type]
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md', size === 'sm' ? 'size-5' : size === 'md' ? 'size-7' : 'size-9')}
      style={{ background: `color-mix(in oklab, ${EVENT_COLOR[type]} 16%, transparent)`, color: EVENT_COLOR[type] }}
    >
      <Icon className={size === 'sm' ? 'size-3' : size === 'md' ? 'size-3.5' : 'size-4.5'} />
    </span>
  )
}

export function EventTypeChip({ type }: { type: SafetyEventType }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <EventIcon type={type} size="sm" />
      <span className="truncate">{SAFETY_EVENT_TYPE[type]}</span>
    </span>
  )
}

export function IncidentTypeChip({ type, label }: { type: IncidentType; label: string }) {
  const Icon = INCIDENT_ICON[type]
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </span>
  )
}

export function EventSeverity({ severity }: { severity: SafetyEvent['severity'] }) {
  return <Badge tone={severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'neutral'}>{severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low'}</Badge>
}

/** Circular driver score gauge. */
export function ScoreRing({ score, size = 52, className }: { score: number; size?: number; className?: string }) {
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = scoreTone(score)
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} role="img" aria-label={`Safety score ${score} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={toneVar[tone]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="num absolute inset-0 flex items-center justify-center text-[15px] font-semibold">{score}</span>
    </div>
  )
}

/** Compact score + bar for tables. */
export function ScoreBar({ score }: { score: number }) {
  const tone = scoreTone(score)
  return (
    <div className="flex items-center gap-2">
      <span className="num w-7 text-right text-[13px] font-semibold" style={{ color: toneVar[tone] }}>{score}</span>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: toneVar[tone] }} />
      </div>
    </div>
  )
}

/** One-line description of an event's measurement: "112 km/h in a 80 zone", "0.54 g", "6.2 h driving". */
export function eventDetail(e: SafetyEvent): string {
  if (e.type === 'speeding') return `${e.speedKph} km/h${e.limitKph ? ` in a ${e.limitKph} km/h zone (+${e.speedKph - e.limitKph})` : ''}`
  if (e.type === 'fatigue') return `${e.value?.toFixed(1) ?? '—'} h continuous driving`
  if (e.value !== undefined && (e.type === 'harsh_braking' || e.type === 'harsh_acceleration' || e.type === 'harsh_cornering')) return `${e.value.toFixed(2)} g at ${e.speedKph} km/h`
  if (e.type === 'idling') return 'Engine idling while stationary'
  return `${e.speedKph} km/h`
}

/** Live feed of the newest safety events — animates in as the GPS simulator raises speeding / harsh-braking events. */
export function LiveEventFeed({ limit = 10, className }: { limit?: number; className?: string }) {
  const events = useDb((s) => s.safetyEvents)
  const { scope } = useBranchScope()
  const getVehicle = useById('vehicles')
  const getDriver = useById('drivers')
  const navigate = useNavigate()
  const now = useNow(15_000)
  const latest = useMemo(() => scope(events).slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit), [events, scope, limit])

  if (!latest.length) return <EmptyState compact title="No safety events yet" description="Events appear here as vehicles are driven." />
  return (
    <ul className={cn('divide-y divide-border/70', className)}>
      <AnimatePresence initial={false}>
        {latest.map((e) => {
          const veh = getVehicle(e.vehicleId)
          const drv = getDriver(e.driverId)
          const fresh = now - new Date(e.timestamp).getTime() < 90_000
          return (
            <motion.li
              key={e.id}
              layout="position"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={cn('flex cursor-pointer items-start gap-2.5 px-3.5 py-2 transition-colors hover:bg-accent/40', fresh && 'bg-primary/6')}
              onClick={() => navigate(`/safety/behaviour?open=${e.id}`)}
            >
              <EventIcon type={e.type} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    <span className="truncate">{SAFETY_EVENT_TYPE[e.type]}</span>
                    {e.severity === 'high' && <StatusDot tone="danger" />}
                    {fresh && <Badge tone="primary" className="px-1 py-px text-[10px]">New</Badge>}
                  </span>
                  <Tooltip content={fmtDateTime(e.timestamp)}><span className="num shrink-0 text-[11px] text-subtle-foreground">{timeAgo(e.timestamp)}</span></Tooltip>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  {veh ? <VehicleLink id={veh.id} /> : <Plate>—</Plate>}
                  <span className="text-border-strong">·</span>
                  {drv ? <DriverLink id={drv.id} /> : <span>Unassigned</span>}
                  <span className="text-border-strong">·</span>
                  <span className="truncate">{eventDetail(e)}</span>
                </p>
                <p className="truncate text-[11px] text-subtle-foreground">{e.location}</p>
              </div>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

function heat(t: number) {
  if (t <= 0) return 'var(--surface-3)'
  const pct = Math.round(18 + t * 72)
  return t < 0.5 ? `color-mix(in oklab, var(--warning) ${pct}%, var(--surface-3))` : `color-mix(in oklab, var(--danger) ${pct}%, var(--surface-3))`
}

/** Day-of-week × time-of-day risk heat-map (severity-weighted events + incidents). */
export function RiskHeatmap({ events, incidents }: { events: SafetyEvent[]; incidents: Incident[] }) {
  const { grid, counts, max, cols, binHours } = useMemo(() => weekHeat(events, incidents, 2), [events, incidents])
  const hr = (c: number) => `${String(c * binHours).padStart(2, '0')}:00–${String((c + 1) * binHours).padStart(2, '0')}:00`
  // find the single riskiest slot to call out
  let best = { r: 0, c: 0, v: -1 }
  grid.forEach((row, r) => row.forEach((v, c) => { if (v > best.v) best = { r, c, v } }))
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `2rem repeat(${cols}, minmax(0, 1fr))` }}>
        <div />
        {Array.from({ length: cols }, (_, c) => (
          <div key={c} className="num text-center text-[10px] text-subtle-foreground">{String(c * binHours).padStart(2, '0')}</div>
        ))}
        {DAY_LABELS.map((d, r) => (
          <Fragment key={d}>
            <div className="flex items-center text-[11px] text-muted-foreground">{d}</div>
            {grid[r]!.map((v, c) => (
              <Tooltip key={c} content={<div className="space-y-0.5"><div className="font-medium">{d} {hr(c)}</div><div className="text-muted-foreground">{counts[r]![c]} event{counts[r]![c] === 1 ? '' : 's'} · risk {v.toFixed(1)} pts</div></div>} delay={60}>
                <div className="h-6 rounded-[4px] ring-1 ring-inset ring-black/5 transition-transform hover:scale-110 sm:h-7" style={{ background: heat(max ? v / max : 0) }} />
              </Tooltip>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-subtle-foreground">
        <span className="flex items-center gap-1.5">
          Lower
          <span className="flex gap-0.5">{[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => <span key={t} className="size-3 rounded-[3px]" style={{ background: heat(t) }} />)}</span>
          Higher
        </span>
        {best.v > 0 && <span className="text-muted-foreground">Riskiest window: <span className="font-medium text-foreground">{DAY_LABELS[best.r]} {hr(best.c)}</span></span>}
      </div>
    </div>
  )
}

export function ViewAllLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="text-xs font-medium text-primary hover:underline">{children}</Link>
}
