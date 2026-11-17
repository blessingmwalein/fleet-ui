import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUp, ChevronDown, ChevronUp, Copy, Fuel, Gauge, History, LocateFixed, MessageSquare, Navigation, Phone, Satellite, UserRound, UserCog, X, Truck, Power, Compass as CompassIcon, MapPin, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { Telemetry } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useById } from '@/hooks/useLookup'
import { useCan } from '@/hooks/useAuth'
import { compass, fmtCoord } from '@/lib/geo'
import { fmtDateTime, fmtDuration, fmtKm, fmtNumber, fmtTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SAFETY_EVENT_TYPE, VEHICLE_CATEGORY } from '@/config/status'
import { Avatar, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/form-controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/menus'
import { CategoryIcon, Plate, Status } from '@/components/shared/Status'
import { TripLink } from '@/components/shared/EntityLink'
import { Timeline, type TimelineItem } from '@/components/shared/Page'

function Stat({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'danger' | 'warning' | 'success' }) {
  return (
    <div className="rounded-md border border-border bg-surface-2/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="size-3" />{label}</div>
      <div className={cn('num mt-0.5 text-[15px] font-semibold leading-tight', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success')}>{value}</div>
      {sub && <div className="truncate text-[11px] text-subtle-foreground">{sub}</div>}
    </div>
  )
}

export function VehiclePanel({
  id, onClose, follow, onToggleFollow, onHistory, onAssign, className, minimized, onToggleMin,
}: {
  id: string
  onClose: () => void
  follow: boolean
  onToggleFollow: () => void
  onHistory: () => void
  onAssign: () => void
  className?: string
  minimized?: boolean
  onToggleMin?: () => void
}) {
  const vehicle = useById('vehicles')(id)
  const t: Telemetry | undefined = useLive((s) => s.telemetry[id])
  const driver = useById('drivers')(vehicle?.driverId)
  const trip = useById('trips')(t?.tripId)
  const customer = useById('customers')(trip?.customerId)
  const events = useDb((s) => s.safetyEvents)
  const canAssign = useCan('vehicles.edit')

  const tripEvents = React.useMemo(() => (trip ? events.filter((e) => e.tripId === trip.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 4) : []), [events, trip])

  if (!vehicle) return null
  const state = t?.state ?? 'stopped'
  const pct = t && t.routeLengthM > 0 && t.tripId ? Math.min(100, Math.round((t.progressM / t.routeLengthM) * 100)) : 0
  const etaMin = t?.etaTs ? Math.max(0, (t.etaTs - Date.now()) / 60000) : null
  const fuelL = t ? Math.round((t.fuelPct / 100) * vehicle.tankCapacityL) : null

  const items: TimelineItem[] = []
  if (trip) {
    items.push({ id: 'dep', title: `Departed ${trip.origin.name.split(' – ')[0]}`, description: trip.cargoDescription, time: fmtTime(trip.actualStart ?? trip.scheduledStart) })
    for (const e of tripEvents.reverse()) items.push({ id: e.id, title: SAFETY_EVENT_TYPE[e.type], description: `${e.location}${e.speedKph ? ` · ${e.speedKph} km/h` : ''}`, time: fmtTime(e.timestamp), tone: e.severity === 'high' ? 'danger' : 'warning', icon: <CircleAlert className="size-3" /> })
    if (trip.status === 'delayed') items.push({ id: 'delay', title: `Delayed +${trip.delayMinutes} min`, description: trip.delayReason, tone: 'warning', icon: <CircleAlert className="size-3" /> })
    if (t?.gpsOnline) items.push({ id: 'now', title: 'En route', description: t.location, time: 'now', icon: <Navigation className="size-3" /> })
    items.push({ id: 'arr', title: `Arrive ${trip.destination.name.split(' – ')[0]}`, description: t?.etaTs ? `ETA ${fmtTime(t.etaTs)} · ${fmtKm(t.remainingKm, 1)} to go` : undefined, done: false })
  }

  return (
    <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18, ease: 'easeOut' }} className={cn('pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-pop', className)}>
      <div className="flex items-start gap-3 border-b border-border px-3.5 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><CategoryIcon category={vehicle.category} className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Plate className="text-[15px]">{vehicle.reg}</Plate>
            <Status kind="live" value={state} />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{vehicle.year} {vehicle.make} {vehicle.model} · {VEHICLE_CATEGORY[vehicle.category]}</div>
        </div>
        {onToggleMin && (
          <Button variant="ghost" size="icon-sm" onClick={onToggleMin} aria-label={minimized ? 'Expand vehicle panel' : 'Minimise vehicle panel'}>{minimized ? <ChevronDown /> : <ChevronUp />}</Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close vehicle panel"><X /></Button>
      </div>

      {minimized && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs">
          <span className="num font-medium">{t?.speedKph ?? 0} km/h · {t ? `${t.heading}° ${compass(t.heading)}` : '—'}</span>
          <span className="truncate text-muted-foreground">{t?.location ?? '—'}</span>
        </div>
      )}

      <div className={cn('min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5', minimized && 'hidden')}>
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={Gauge} label="Speed" value={`${t?.speedKph ?? 0} km/h`} sub={`Limit ${t?.limitKph ?? '—'}`} tone={t?.speeding ? 'danger' : undefined} />
          <Stat
            icon={CompassIcon}
            label="Heading"
            value={
              t ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-full border border-border bg-surface-3"><ArrowUp className="size-3.5 text-primary transition-transform duration-500" style={{ transform: `rotate(${t.heading}deg)` }} /></span>
                  {t.heading}° {compass(t.heading)}
                </span>
              ) : '—'
            }
            sub={t?.state === 'moving' ? 'Direction of travel' : 'Last heading'}
          />
          <Stat icon={Fuel} label="Fuel" value={`${Math.round(t?.fuelPct ?? vehicle.fuelPct)}%`} sub={fuelL ? `≈ ${fuelL} L` : undefined} tone={(t?.fuelPct ?? 100) < 15 ? 'danger' : (t?.fuelPct ?? 100) < 30 ? 'warning' : undefined} />
          <Stat icon={Truck} label="Odometer" value={fmtNumber(t?.odometerKm ?? vehicle.odometerKm)} sub="km" />
          <Stat icon={Power} label="Engine" value={t?.engineOn ? 'On' : 'Off'} tone={t?.engineOn ? 'success' : undefined} />
          <Stat icon={Satellite} label="GPS" value={t?.gpsOnline ? 'Online' : 'Offline'} sub={t ? timeAgo(t.lastFixTs) : undefined} tone={t?.gpsOnline ? 'success' : 'danger'} />
        </div>

        <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="label-xs mb-0.5">Exact location</div>
              <div className="text-[13px] font-medium leading-snug">{t?.location ?? '—'}</div>
              {t && <div className="num mt-0.5 text-[11px] text-subtle-foreground">{fmtCoord(t)}</div>}
            </div>
            {t && <Button variant="ghost" size="icon-xs" aria-label="Copy coordinates" onClick={() => { void navigator.clipboard?.writeText(`${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}`); toast.success('Coordinates copied') }}><Copy /></Button>}
          </div>
        </div>

        {driver ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
            <Avatar name={driver.name} size={34} />
            <div className="min-w-0 flex-1">
              <Link to={`/drivers/${driver.id}`} className="block truncate text-[13px] font-medium hover:text-primary hover:underline">{driver.name}</Link>
              <div className="truncate text-xs text-muted-foreground">{driver.licenceClass} · {driver.phone}</div>
            </div>
            <Badge tone={driver.safetyScore >= 85 ? 'success' : driver.safetyScore >= 70 ? 'warning' : 'danger'} title="Safety score">{driver.safetyScore}</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground"><UserRound className="size-4" /> No driver assigned</div>
        )}

        {trip ? (
          <div className="rounded-md border border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <TripLink id={trip.id} className="font-mono text-[12.5px] font-medium" />
              <Status kind="trip" value={trip.status} />
            </div>
            <div className="mt-1.5 text-[13px] font-medium leading-snug">{trip.origin.name.split(' – ')[0]} → {trip.destination.name.split(' – ')[0]}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{trip.cargoDescription} · {fmtNumber(trip.cargoWeightKg)} kg{customer ? ` · ${customer.name}` : ''}</div>
            <div className="mt-2.5 flex items-center gap-2">
              <Progress value={pct} className="flex-1" />
              <span className="num w-9 text-right text-xs font-medium">{pct}%</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-subtle-foreground">Remaining</div><div className="num font-medium">{t ? fmtKm(t.remainingKm, 1) : '—'}</div></div>
              <div><div className="text-subtle-foreground">ETA</div><div className="num font-medium">{t?.etaTs ? fmtTime(t.etaTs) : '—'}</div></div>
              <div><div className="text-subtle-foreground">In</div><div className="num font-medium">{etaMin !== null ? fmtDuration(etaMin) : '—'}</div></div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">No active trip. Last update {t ? fmtDateTime(t.lastFixTs) : '—'}.</div>
        )}

        {items.length > 0 && (
          <div>
            <div className="label-xs mb-2">Route progress & trip events</div>
            <Timeline items={items} />
          </div>
        )}
      </div>

      <div className={cn('grid grid-cols-2 gap-2 border-t border-border bg-surface-2/40 p-3', minimized && 'hidden')}>
        <Button asChild variant="outline" size="sm"><Link to={`/vehicles/${vehicle.id}`}><Truck /> Vehicle profile</Link></Button>
        <Button asChild variant="outline" size="sm" disabled={!driver}>{driver ? <Link to={`/drivers/${driver.id}`}><UserRound /> View driver</Link> : <span><UserRound /> View driver</span>}</Button>
        <Button variant={follow ? 'default' : 'outline'} size="sm" onClick={onToggleFollow} disabled={!t?.gpsOnline}><LocateFixed /> {follow ? 'Following' : 'Track trip'}</Button>
        <Button variant="outline" size="sm" onClick={onHistory}><History /> Journey history</Button>
        <Button variant="outline" size="sm" onClick={onAssign} disabled={!canAssign}><UserCog /> Assign vehicle</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!driver}><Phone /> Contact driver</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel>{driver?.name}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => toast.success(`Calling ${driver?.name}…`, { description: `${driver?.phone} (demo — no call is placed)` })}><Phone /> Call {driver?.phone}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.success('SMS sent', { description: `To ${driver?.name}: "Please confirm your ETA." (demo)` })}><MessageSquare /> Send SMS</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.success('Dispatch message sent', { description: `Delivered to the driver app of ${vehicle.reg} (demo)` })}><Navigation /> Push dispatch message</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  )
}
