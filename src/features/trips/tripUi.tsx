import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Ban, CircleCheck, CircleX, Clock, Copy, Eye, Flag, Info, Pencil, RotateCcw, Send, Trash2, TriangleAlert, UserPlus, CalendarClock, type LucideIcon } from 'lucide-react'
import type { Trip, TripStatus } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useUi } from '@/store/ui'
import { useCan } from '@/hooks/useAuth'
import type { ComboOption } from '@/components/ui/command'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/menus'
import { MoreHorizontal } from 'lucide-react'
import { Progress } from '@/components/ui/form-controls'
import type { RowAction } from '@/components/data-table/DataTable'
import { PRIORITY, TRIP_STATUS, VEHICLE_CATEGORY } from '@/config/status'
import { fmtDuration, fmtTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BOARD_COLUMNS, isActive, liveProgress, type Check } from './tripLogic'
import { openAssign, openComplete, openDelay, openTripForm, planTransition, requestDelete, requestStatus } from './tripStore'

export function PriorityBadge({ priority, className }: { priority: Trip['priority']; className?: string }) {
  const meta = PRIORITY[priority] ?? PRIORITY.normal!
  return (
    <Badge tone={priority === 'low' ? 'outline' : meta.tone} className={cn(priority === 'low' && 'text-muted-foreground', className)}>
      {meta.label}
    </Badge>
  )
}

export function DelayChip({ minutes, className }: { minutes: number; className?: string }) {
  if (minutes <= 0) return null
  return (
    <Badge tone="danger" className={className}>
      <Clock /> +{fmtDuration(minutes)}
    </Badge>
  )
}

/** Live telemetry-backed progress of a trip (re-renders on each GPS tick for in-transit trips only). */
export function useTripProgress(trip: Trip) {
  const tel = useLive((s) => (trip.vehicleId && isActive(trip.status) ? s.telemetry[trip.vehicleId] : undefined))
  return React.useMemo(() => liveProgress(trip, tel), [trip, tel])
}

export function TripProgressBar({ trip, showDetails = true, className }: { trip: Trip; showDetails?: boolean; className?: string }) {
  const p = useTripProgress(trip)
  const delayed = trip.status === 'delayed'
  return (
    <div className={cn('space-y-1', className)}>
      <Progress value={p.pct} indicatorClassName={delayed ? 'bg-danger' : undefined} aria-label="Trip progress" className="h-1.5" />
      {showDetails && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="num">
            {Math.round(p.pct)}%{p.remainingKm !== null && ` · ${Math.round(p.remainingKm).toLocaleString('en-US')} km left`}
          </span>
          <span className="num truncate">{p.etaTs ? `ETA ${fmtTime(p.etaTs)}` : '—'}</span>
        </div>
      )}
    </div>
  )
}

/** Checklist of assignment / dispatch validation results. */
export function ChecksList({ checks, className }: { checks: Check[]; className?: string }) {
  if (!checks.length) return null
  const icon = { block: <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" />, warn: <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />, ok: <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> }
  return (
    <ul className={cn('space-y-1.5', className)}>
      {checks.map((c, i) => (
        <li key={i} className={cn('flex gap-2 text-xs', c.level === 'block' ? 'text-danger' : c.level === 'warn' ? 'text-foreground' : 'text-muted-foreground')}>
          {icon[c.level]}
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Vehicle and driver pickers: active only, with availability hints. The current selection is always kept in the list. */
export function useCrewOptions(currentVehicleId?: string | null, currentDriverId?: string | null) {
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const trips = useDb((s) => s.trips)
  return React.useMemo(() => {
    const busyV = new Set<string>()
    const busyD = new Set<string>()
    for (const t of trips) {
      if (!isActive(t.status)) continue
      if (t.vehicleId) busyV.add(t.vehicleId)
      if (t.driverId) busyD.add(t.driverId)
    }
    const vehicleOptions: ComboOption[] = vehicles
      .filter((v) => v.status === 'active' || v.id === currentVehicleId)
      .map((v) => ({ value: v.id, label: v.reg, hint: `${VEHICLE_CATEGORY[v.category]} · ${(v.loadCapacityKg / 1000).toFixed(v.loadCapacityKg % 1000 ? 1 : 0)} t · ${v.status !== 'active' ? 'unavailable' : busyV.has(v.id) ? 'on trip' : 'available'}` }))
      .sort((a, b) => Number(a.hint!.endsWith('on trip')) - Number(b.hint!.endsWith('on trip')) || a.label.localeCompare(b.label))
    const driverOptions: ComboOption[] = drivers
      .filter((d) => d.status === 'active' || d.id === currentDriverId)
      .map((d) => ({ value: d.id, label: d.name, hint: `${d.licenceClass} · ${d.status !== 'active' ? d.status.replace('_', ' ') : busyD.has(d.id) ? 'on trip' : 'available'}` }))
      .sort((a, b) => Number(a.hint!.endsWith('on trip')) - Number(b.hint!.endsWith('on trip')) || a.label.localeCompare(b.label))
    return { vehicleOptions, driverOptions }
  }, [vehicles, drivers, trips, currentVehicleId, currentDriverId])
}

/** `/dispatch?new=1` opens the create dialog; `?open=<id>` opens the trip drawer. */
export function useTripDeepLinks() {
  const [params, setParams] = useSearchParams()
  const canCreate = useCan('dispatch.create')
  React.useEffect(() => {
    const wantNew = params.get('new') === '1'
    const openId = params.get('open')
    if (!wantNew && !openId) return
    if (wantNew) {
      if (canCreate) openTripForm()
      else toast.error('Permission required', { description: 'Your role cannot create trips.' })
    }
    if (openId) useUi.getState().openTrip(openId)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        next.delete('open')
        return next
      },
      { replace: true },
    )
  }, [params, setParams, canCreate])
}

export interface TripPerms {
  edit: boolean
  create: boolean
  del: boolean
}
export function useTripPerms(): TripPerms {
  return { edit: useCan('dispatch.edit'), create: useCan('dispatch.create'), del: useCan('dispatch.delete') }
}

export function duplicateTrip(trip: Trip) {
  openTripForm({
    defaults: { customerId: trip.customerId ?? undefined, routeId: trip.routeId, cargoType: trip.cargoType, cargoDescription: trip.cargoDescription, cargoWeightKg: trip.cargoWeightKg, priority: trip.priority, notes: trip.notes },
  })
}

export interface TripAction extends RowAction {
  key: string
  icon: React.ReactNode
  primary?: boolean
  Icon: LucideIcon
}

/** Contextual actions for a trip given its status and the user's permissions. */
export function tripActionList(trip: Trip, perms: TripPerms): TripAction[] {
  const s = trip.status
  const crew = !!trip.vehicleId && !!trip.driverId
  const mk = (key: string, label: string, Icon: LucideIcon, onClick: () => void, o: { hidden?: boolean; destructive?: boolean; primary?: boolean; separatorBefore?: boolean } = {}): TripAction => ({
    key, label, Icon, icon: <Icon />, onClick, hidden: o.hidden, destructive: o.destructive, primary: o.primary, separatorBefore: o.separatorBefore,
  })
  const draft = s === 'awaiting_assignment' || s === 'scheduled' || s === 'ready'
  return [
    mk('view', 'View details', Eye, () => useUi.getState().openTrip(trip.id)),
    mk('assign', crew ? 'Reassign vehicle / driver' : 'Assign vehicle & driver', UserPlus, () => openAssign([trip.id]), { hidden: !perms.edit || !draft, primary: s === 'awaiting_assignment' }),
    mk('dispatch', 'Dispatch', Send, () => void requestStatus(trip.id, 'in_transit'), { hidden: !perms.edit || (s !== 'scheduled' && s !== 'ready'), primary: s === 'ready' || s === 'scheduled' }),
    mk('ready', 'Mark ready for dispatch', CalendarClock, () => void requestStatus(trip.id, 'ready'), { hidden: !perms.edit || s !== 'scheduled' || !crew }),
    mk('complete', s === 'completed' ? 'Update proof of delivery' : 'Complete delivery', Flag, () => (s === 'completed' ? openComplete(trip.id) : void requestStatus(trip.id, 'completed')), { hidden: !perms.edit || !(s === 'in_transit' || s === 'delayed' || s === 'completed'), primary: s === 'in_transit' || s === 'delayed' }),
    mk('delay', s === 'delayed' ? 'Update delay' : 'Report delay', Clock, () => (s === 'delayed' ? openDelay(trip.id) : void requestStatus(trip.id, 'delayed')), { hidden: !perms.edit || !(s === 'in_transit' || s === 'delayed') }),
    mk('clear', 'Clear delay', RotateCcw, () => void requestStatus(trip.id, 'in_transit'), { hidden: !perms.edit || s !== 'delayed' }),
    mk('reinstate', 'Reinstate trip', RotateCcw, () => void requestStatus(trip.id, 'awaiting_assignment'), { hidden: !perms.edit || s !== 'cancelled', primary: true }),
    mk('edit', s === 'completed' || s === 'in_transit' || s === 'delayed' ? 'Edit cargo, notes & revenue' : 'Edit trip', Pencil, () => openTripForm({ tripId: trip.id }), { hidden: !perms.edit || s === 'cancelled', separatorBefore: true }),
    mk('duplicate', 'Duplicate trip', Copy, () => duplicateTrip(trip), { hidden: !perms.create }),
    mk('cancel', 'Cancel trip', Ban, () => void requestStatus(trip.id, 'cancelled'), { hidden: !perms.edit || s === 'completed' || s === 'cancelled', destructive: true, separatorBefore: true }),
    mk('delete', 'Delete trip', Trash2, () => void requestDelete([trip.id]), { hidden: !perms.del || !draft, destructive: true }),
  ]
}

const MOVE_TARGETS: TripStatus[] = BOARD_COLUMNS

/** Kebab menu for a trip: contextual actions plus a "Move to" submenu (keyboard / touch alternative to drag & drop). */
export function TripMenu({ trip, perms, className }: { trip: Trip; perms: TripPerms; className?: string }) {
  const actions = tripActionList(trip, perms).filter((a) => !a.hidden)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${trip.ref}`} className={className} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" onClick={(e) => e.stopPropagation()}>
        {actions.map((a, i) => (
          <React.Fragment key={a.key}>
            {a.separatorBefore && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem destructive={a.destructive} onSelect={a.onClick}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
        {perms.edit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Info /> Move to…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuLabel>Move {trip.ref} to</DropdownMenuLabel>
                {MOVE_TARGETS.map((st) => {
                  const plan = planTransition(trip, st)
                  return (
                    <DropdownMenuItem key={st} disabled={plan.mode === 'same'} onSelect={() => void requestStatus(trip.id, st)} className={cn(plan.mode === 'blocked' && 'text-subtle-foreground')}>
                      {TRIP_STATUS[st].label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function startsLabel(trip: Trip) {
  return `${fmtTime(trip.scheduledStart)} · ${timeAgo(trip.scheduledStart)}`
}
