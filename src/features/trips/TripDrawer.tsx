import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Camera, CircleAlert, Fuel, Gauge, MapPin, Navigation, Package, Receipt, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react'
import type { Trip } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useUi } from '@/store/ui'
import { ROUTE_BY_ID } from '@/data/routes'
import { useById } from '@/hooks/useLookup'
import { useMoney } from '@/hooks/useMoney'
import { Sheet, SheetContent, SheetBody, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/display'
import { MiniMap, type MiniMapMarker } from '@/components/map/MiniMap'
import { DetailGrid, Panel, Timeline, type TimelineItem } from '@/components/shared/Page'
import { CategoryBadge, CategoryIcon, ExpiryBadge, Status } from '@/components/shared/Status'
import { BranchLink, CustomerLink, DriverLink, EntityLink, ShipmentLink, VehicleLink } from '@/components/shared/EntityLink'
import { CARGO_TYPE, EXPENSE_CATEGORY, SHIPMENT_STATUS } from '@/config/status'
import { fmtDate, fmtDateTime, fmtDuration, fmtKm, fmtNumber, fmtTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isActive, isOnTime, startOverdueMin, tripMargin, tripMarginPct } from './tripLogic'
import { DelayChip, PriorityBadge, TripMenu, tripActionList, useTripPerms, useTripProgress } from './tripUi'

export default function TripDrawer() {
  const id = useUi((s) => s.tripDrawerId)
  const openTrip = useUi((s) => s.openTrip)
  const [lastId, setLastId] = React.useState<string | null>(id)
  const getTrip = useById('trips')
  React.useEffect(() => {
    if (id) setLastId(id)
  }, [id])
  const trip = getTrip(id ?? lastId)
  // trip deleted while the drawer is open
  React.useEffect(() => {
    if (id && !trip) openTrip(null)
  }, [id, trip, openTrip])

  return (
    <Sheet open={!!id && !!trip} onOpenChange={(o) => !o && openTrip(null)}>
      <SheetContent size="xl" aria-describedby={undefined}>
        {trip ? <DrawerContent trip={trip} /> : <SheetTitle className="sr-only">Trip</SheetTitle>}
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-2/40 px-3 py-2">
      <div className="label-xs">{label}</div>
      <div className={cn('num mt-0.5 truncate text-[15px] font-semibold leading-tight', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function DrawerContent({ trip }: { trip: Trip }) {
  const perms = useTripPerms()
  const money = useMoney()
  const getVehicle = useById('vehicles')
  const getDriver = useById('drivers')
  const getCustomer = useById('customers')
  const vehicle = getVehicle(trip.vehicleId)
  const driver = getDriver(trip.driverId)
  const customer = getCustomer(trip.customerId)
  const tel = useLive((s) => (trip.vehicleId ? s.telemetry[trip.vehicleId] : undefined))
  const live = useTripProgress(trip)
  const route = ROUTE_BY_ID[trip.routeId]
  const active = isActive(trip.status)
  const overdue = startOverdueMin(trip)
  const expenses = useDb((s) => s.expenses)
  const fuel = useDb((s) => s.fuelTransactions)
  const shipments = useDb((s) => s.shipments)
  const audit = useDb((s) => s.auditLog)
  const linkedExpenses = React.useMemo(() => expenses.filter((e) => e.tripId === trip.id), [expenses, trip.id])
  const linkedFuel = React.useMemo(() => fuel.filter((f) => f.tripId === trip.id), [fuel, trip.id])
  const shipment = React.useMemo(() => shipments.find((s) => s.id === trip.shipmentId || s.tripId === trip.id), [shipments, trip.shipmentId, trip.id])
  const activity = React.useMemo(() => audit.filter((a) => a.entityType === 'trip' && a.entityId === trip.id).slice(0, 8), [audit, trip.id])
  const markers = React.useMemo<MiniMapMarker[]>(
    () => [
      { id: 'o', lat: trip.origin.lat, lng: trip.origin.lng, kind: 'origin', label: trip.origin.city },
      { id: 'd', lat: trip.destination.lat, lng: trip.destination.lng, kind: 'destination', label: trip.destination.city },
    ],
    [trip.origin, trip.destination],
  )
  const progressM = trip.status === 'completed' ? route?.lengthM : active && tel?.tripId === trip.id ? tel.progressM : undefined
  const actions = tripActionList(trip, perms).filter((a) => !a.hidden)
  const buttonKeys = ['assign', 'dispatch', 'ready', 'complete', 'delay', 'clear', 'reinstate', 'edit']
  const margin = tripMargin(trip)
  const marginPct = tripMarginPct(trip)
  const costTotal = trip.expensesUsd

  const timeline: TimelineItem[] = [
    { id: 'created', title: 'Trip created', time: fmtDateTime(trip.createdAt), description: customer ? `Booked for ${customer.name}` : undefined },
    ...(vehicle && driver ? [{ id: 'assigned', title: 'Crew assigned', description: `${vehicle.reg} · ${driver.name}`, done: true }] : [{ id: 'assigned', title: 'Awaiting vehicle & driver', done: false, tone: 'warning' as const }]),
    { id: 'sched', title: trip.actualStart || new Date(trip.scheduledStart).getTime() <= Date.now() ? 'Scheduled start' : 'Scheduled to start', time: fmtDateTime(trip.scheduledStart), done: !!trip.actualStart || new Date(trip.scheduledStart).getTime() <= Date.now() },
    trip.actualStart ? { id: 'dispatched', title: 'Dispatched – vehicle departed', time: fmtDateTime(trip.actualStart), description: `Planned arrival ${fmtDateTime(trip.plannedEnd)}`, done: true } : { id: 'dispatched', title: 'Awaiting dispatch', done: false },
    ...(trip.delayMinutes > 0 && trip.status !== 'cancelled' ? [{ id: 'delay', title: `Delayed ${fmtDuration(trip.delayMinutes)}`, description: trip.delayReason, tone: 'warning' as const, done: true }] : []),
    ...(trip.status === 'completed'
      ? [{ id: 'done', title: 'Delivered', time: fmtDateTime(trip.actualEnd), description: trip.pod ? `Received by ${trip.pod.receivedBy}` : 'No proof of delivery recorded', done: true }]
      : trip.status === 'cancelled'
        ? [{ id: 'cancel', title: 'Cancelled', description: trip.delayReason, tone: 'danger' as const, done: true }]
        : [{ id: 'eta', title: 'Delivery', time: `ETA ${fmtDateTime(live.etaTs ?? new Date(trip.plannedEnd).getTime() + trip.delayMinutes * 6e4)}`, done: false }]),
  ]

  return (
    <>
      <SheetHeader className="pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="num text-base">{trip.ref}</SheetTitle>
          <Status kind="trip" value={trip.status} pulse={trip.status === 'in_transit'} />
          <PriorityBadge priority={trip.priority} />
          <DelayChip minutes={trip.delayMinutes} />
          {overdue > 0 && <Badge tone="danger"><CircleAlert /> Start overdue {fmtDuration(overdue)}</Badge>}
        </div>
        <SheetDescription className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-foreground">{trip.origin.name}</span>
          <ArrowRight className="size-3.5" />
          <span className="text-foreground">{trip.destination.name}</span>
          <span>· {route?.name ?? 'Custom route'}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/30 px-5 py-2.5">
        {actions.filter((a) => buttonKeys.includes(a.key)).map((a) => (
          <Button key={a.key} size="sm" variant={a.primary ? 'default' : 'outline'} onClick={a.onClick}>
            {a.icon}
            {a.label}
          </Button>
        ))}
        <TripMenu trip={trip} perms={perms} className="ml-auto size-7" />
      </div>

      <SheetBody className="space-y-4">
        {/* Route + live status */}
        <Panel title="Route" description={route ? `${route.road} · ${route.kind === 'highway' ? 'Highway' : 'City'} route` : undefined} flush>
          <MiniMap height={230} routeId={trip.routeId} routeDir={trip.routeDir} progressM={progressM} vehicleId={active ? (trip.vehicleId ?? undefined) : undefined} markers={markers} className="rounded-none border-0" />
          <div className="space-y-3 p-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex gap-2 text-[13px]"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><div className="min-w-0"><div className="label-xs">Pickup</div><div className="truncate">{trip.origin.name}</div><div className="text-xs text-muted-foreground">{trip.origin.city}</div></div></div>
              <div className="flex gap-2 text-[13px]"><Navigation className="mt-0.5 size-4 shrink-0 text-danger" /><div className="min-w-0"><div className="label-xs">Delivery</div><div className="truncate">{trip.destination.name}</div><div className="text-xs text-muted-foreground">{trip.destination.city}</div></div></div>
            </div>
            {(active || trip.status === 'completed') && (
              <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">{trip.status === 'completed' ? 'Delivered' : `${Math.round(live.pct)}% complete`}</span>
                  <span className="num text-muted-foreground">{trip.status === 'completed' ? fmtDateTime(trip.actualEnd) : live.etaTs ? `ETA ${fmtTime(live.etaTs)} · ${timeAgo(live.etaTs).replace(' ago', ' ago')}` : '—'}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full transition-all duration-700', trip.status === 'delayed' ? 'bg-danger' : 'bg-primary')} style={{ width: `${live.pct}%` }} /></div>
                {active && (
                  <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                    <div><span className="text-muted-foreground">Remaining</span> <span className="num font-medium">{live.remainingKm !== null ? fmtKm(live.remainingKm, 0) : '—'}</span></div>
                    <div className="flex items-center gap-1"><Gauge className="size-3 text-muted-foreground" /><span className="num font-medium">{live.speed !== null ? `${live.speed} km/h` : 'No GPS'}</span></div>
                    <div className="flex items-center gap-1"><Fuel className="size-3 text-muted-foreground" /><span className="num font-medium">{tel ? `${Math.round(tel.fuelPct)}%` : '—'}</span></div>
                    <div className="flex items-center gap-1">{tel && <Status kind="live" value={tel.state} />}</div>
                    {live.location && <div className="col-span-2 truncate text-muted-foreground sm:col-span-4">{live.location}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>

        {/* Planned vs actual */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Distance" value={fmtKm(trip.actualDistanceKm ?? trip.plannedDistanceKm, 1)} sub={trip.actualDistanceKm !== null ? `planned ${fmtKm(trip.plannedDistanceKm, 1)}` : 'planned'} />
          <Stat
            label="Duration"
            value={fmtDuration(trip.actualDurationMin ?? trip.plannedDurationMin)}
            sub={trip.actualDurationMin !== null ? `planned ${fmtDuration(trip.plannedDurationMin)}` : active ? `planned · ${fmtDuration(trip.plannedDurationMin)}` : 'planned'}
          />
          <Stat label="Delay" value={trip.delayMinutes > 0 ? `+${fmtDuration(trip.delayMinutes)}` : trip.status === 'completed' ? 'On time' : '—'} sub={trip.delayReason && trip.status !== 'cancelled' ? trip.delayReason : trip.status === 'completed' ? (isOnTime(trip) ? 'within 15 min of plan' : undefined) : undefined} tone={trip.delayMinutes > 15 ? 'danger' : trip.status === 'completed' ? 'success' : undefined} />
          <Stat label="Margin" value={money(margin)} sub={trip.revenueUsd > 0 ? `${marginPct.toFixed(0)}% of ${money(trip.revenueUsd)}` : 'no revenue'} tone={margin < 0 ? 'danger' : trip.status === 'completed' ? 'success' : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Cargo & customer" actions={<Package className="size-4 text-muted-foreground" />}>
            <DetailGrid
              columns={1}
              items={[
                { label: 'Customer', value: customer ? <CustomerLink id={customer.id} /> : '—' },
                { label: 'Cargo', value: `${CARGO_TYPE[trip.cargoType]} · ${trip.cargoDescription}` },
                { label: 'Weight', value: `${fmtNumber(trip.cargoWeightKg)} kg${vehicle ? ` (${Math.round((trip.cargoWeightKg / vehicle.loadCapacityKg) * 100)}% of ${fmtNumber(vehicle.loadCapacityKg)} kg capacity)` : ''}` },
                { label: 'Scheduled start', value: fmtDateTime(trip.scheduledStart) },
                { label: 'Branch', value: <BranchLink id={trip.branchId} /> },
              ]}
            />
          </Panel>
          <Panel title="Vehicle & driver" actions={perms.edit && (trip.status === 'awaiting_assignment' || trip.status === 'scheduled' || trip.status === 'ready') ? <Button size="xs" variant="outline" onClick={() => actions.find((a) => a.key === 'assign')?.onClick()}>{vehicle ? 'Reassign' : 'Assign'}</Button> : undefined}>
            <div className="space-y-3">
              {vehicle ? (
                <div className="flex items-start gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3"><CategoryIcon category={vehicle.category} className="text-muted-foreground" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><VehicleLink id={vehicle.id} />{tel && <Status kind="live" value={tel.state} />}</div>
                    <p className="text-xs text-muted-foreground">{vehicle.make} {vehicle.model} · <CategoryBadge category={vehicle.category} /></p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"><TriangleAlert className="size-3.5" /> No vehicle assigned</div>
              )}
              {driver ? (
                <div className="flex items-start gap-2.5">
                  <Avatar name={driver.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <DriverLink id={driver.id} />
                    <p className="text-xs text-muted-foreground">{driver.licenceClass} · safety score <span className="num">{driver.safetyScore}</span></p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">Licence <ExpiryBadge iso={driver.licenceExpiry} /></div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"><UserRound className="size-3.5" /> No driver assigned</div>
              )}
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Timeline">
            <Timeline items={timeline} />
          </Panel>
          <Panel title="Costs & revenue" actions={<Receipt className="size-4 text-muted-foreground" />}>
            <div className="space-y-3 text-[13px]">
              <div className="grid grid-cols-3 gap-2">
                <div><div className="label-xs">Revenue</div><div className="num font-medium">{money(trip.revenueUsd)}</div></div>
                <div><div className="label-xs">Costs</div><div className="num font-medium">{money(costTotal)}</div></div>
                <div><div className="label-xs">Margin</div><div className={cn('num font-medium', margin < 0 ? 'text-danger' : 'text-success')}>{money(margin)}</div></div>
              </div>
              {linkedExpenses.length === 0 && linkedFuel.length === 0 ? (
                <p className="text-xs text-muted-foreground">No expenses or fuel purchases linked to this trip yet.</p>
              ) : (
                <ul className="divide-y divide-border/70 rounded-md border border-border">
                  {linkedFuel.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5"><Fuel className="size-3.5 shrink-0 text-muted-foreground" /><EntityLink type="fuel" id={f.id} /><span className="truncate text-muted-foreground">{fmtNumber(f.litres, 0)} L</span></span>
                      <span className="num">{money(f.totalUsd, { digits: 2 })}</span>
                    </li>
                  ))}
                  {linkedExpenses.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5"><Receipt className="size-3.5 shrink-0 text-muted-foreground" /><EntityLink type="expense" id={e.id} /><span className="truncate text-muted-foreground">{EXPENSE_CATEGORY[e.category]}</span></span>
                      <span className="num">{money(e.amountUsd, { digits: 2 })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Proof of delivery" actions={trip.status === 'completed' && perms.edit ? <Button size="xs" variant="outline" onClick={() => actions.find((a) => a.key === 'complete')?.onClick()}>Update</Button> : undefined}>
            {trip.pod ? (
              <DetailGrid
                columns={2}
                items={[
                  { label: 'Received by', value: trip.pod.receivedBy },
                  { label: 'Signed', value: fmtDateTime(trip.pod.signedAt) },
                  { label: 'Condition', value: <Badge tone={trip.pod.conditionOk ? 'success' : 'danger'}>{trip.pod.conditionOk ? 'Good' : 'Damaged / short'}</Badge> },
                  { label: 'Photos', value: <span className="inline-flex items-center gap-1"><Camera className="size-3.5 text-muted-foreground" />{trip.pod.photoCount}</span> },
                  { label: 'Notes', value: trip.pod.notes ?? '—', hidden: !trip.pod.notes },
                ]}
              />
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" />{active ? 'Proof of delivery is captured when the trip is completed.' : trip.status === 'completed' ? 'No proof of delivery was recorded for this trip.' : 'Not applicable yet.'}</p>
            )}
          </Panel>
          <Panel title="Linked shipment">
            {shipment ? (
              <div className="space-y-2 text-[13px]">
                <div className="flex items-center justify-between gap-2"><ShipmentLink id={shipment.id} /><Badge tone={SHIPMENT_STATUS[shipment.status].tone}>{SHIPMENT_STATUS[shipment.status].label}</Badge></div>
                <p className="text-xs text-muted-foreground">{shipment.cargoDescription} · {fmtNumber(shipment.weightKg)} kg · {shipment.packages} packages</p>
                <p className="text-xs text-muted-foreground">Delivery ETA {fmtDate(shipment.deliveryEta)}</p>
                {shipment.exception && !shipment.exception.resolved && <p className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">Exception: {shipment.exception.type}</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No customer shipment is linked to this trip. <Link to="/shipments" className="text-primary hover:underline">Browse shipments</Link></p>
            )}
          </Panel>
        </div>

        {(trip.notes || activity.length > 0) && (
          <Panel title="Notes & activity">
            {trip.notes && <p className="mb-3 rounded-md bg-surface-2/60 px-3 py-2 text-[13px]">{trip.notes}</p>}
            {activity.length > 0 && (
              <ul className="space-y-1.5">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate"><span className="font-medium">{a.userName}</span> <span className="text-muted-foreground">· {a.summary}</span></span>
                    <span className="num shrink-0 text-subtle-foreground">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </SheetBody>
    </>
  )
}
