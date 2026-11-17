import { useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Copy, Link2, Mail, MoreHorizontal, Pencil, Phone, ShieldCheck, Trash2, Truck, TriangleAlert, PackageSearch, Gauge, Navigation, Clock, Route as RouteIcon } from 'lucide-react'
import type { Shipment } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useMoney } from '@/hooks/useMoney'
import { ROUTE_BY_ID } from '@/data/routes'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Tooltip } from '@/components/ui/overlays'
import { MiniMap, type MiniMapMarker } from '@/components/map/MiniMap'
import { DetailGrid, Page, Panel, Timeline, type TimelineItem } from '@/components/shared/Page'
import { Status } from '@/components/shared/Status'
import { BranchLink, CustomerLink, DriverLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { haversineM } from '@/lib/geo'
import { fmtDateTime, fmtDuration, fmtKm, fmtNumber, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { LIVE_STATE, PRIORITY, VEHICLE_CATEGORY } from '@/config/status'
import { DeliveryStepper } from './DeliveryStepper'
import { useShipmentActions } from './useShipmentActions'
import { canAllocate, canCapturePod, canRaiseException, canUpdateStatus, cargoLabel, exceptionMilestones, fmtWeight, isOpenException, isOverdue, stageMilestones } from './shipmentLib'

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      toast.success(`${what} copied`)
    } catch {
      toast.error('Could not copy to clipboard')
    }
    ta.remove()
  }
}

export default function ShipmentDetailPage() {
  const { id } = useParams()
  const shipment = useDb((s) => s.shipments.find((x) => x.id === id))
  if (!shipment)
    return (
      <Page>
        <div className="panel">
          <EmptyState icon={PackageSearch} title="Shipment not found" description="It may have been deleted or the link is incorrect." action={<Button asChild size="sm"><Link to="/shipments">Back to shipments</Link></Button>} />
        </div>
      </Page>
    )
  return <Detail s={shipment} />
}

function Detail({ s }: { s: Shipment }) {
  const nav = useNavigate()
  const money = useMoney()
  const actions = useShipmentActions()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); if (t === 'overview') n.delete('tab'); else n.set('tab', t); return n }, { replace: true })

  const trip = useDb((st) => (s.tripId ? st.trips.find((t) => t.id === s.tripId) : undefined))
  const vehicle = useDb((st) => (s.vehicleId ? st.vehicles.find((v) => v.id === s.vehicleId) : undefined))
  const driver = useDb((st) => (s.driverId ? st.drivers.find((d) => d.id === s.driverId) : undefined))
  const customer = useDb((st) => st.customers.find((c) => c.id === s.customerId))
  const auditLog = useDb((st) => st.auditLog)
  const expenses = useDb((st) => st.expenses)
  const tel = useLive((st) => (s.vehicleId ? st.telemetry[s.vehicleId] : undefined))

  const route = trip ? ROUTE_BY_ID[trip.routeId] : undefined
  const onTrip = !!trip && tel?.tripId === trip.id
  const overdue = isOverdue(s)
  const delivered = s.status === 'delivered'
  const open = isOpenException(s)
  const next = actions.nextStep(s)
  const progressM = delivered && route ? route.lengthM : onTrip ? Math.round(tel!.progressM / 1000) * 1000 : undefined
  const markers = useMemo<MiniMapMarker[]>(
    () => [
      { id: 'pickup', lat: s.pickup.lat, lng: s.pickup.lng, kind: 'origin', label: s.pickup.city },
      { id: 'delivery', lat: s.delivery.lat, lng: s.delivery.lng, kind: 'destination', label: s.delivery.city },
    ],
    [s.pickup, s.delivery],
  )
  const directKm = haversineM(s.pickup, s.delivery) / 1000
  const etaTs = onTrip && tel!.etaTs ? tel!.etaTs : new Date(s.deliveryEta).getTime()

  const audit = useMemo(() => auditLog.filter((a) => a.entityId === s.id || (trip && a.entityId === trip.id)).slice(0, 40), [auditLog, s.id, trip])
  const tripExpenses = useMemo(() => (trip ? expenses.filter((e) => e.tripId === trip.id) : []), [expenses, trip])

  const trackingUrl = `${window.location.origin}/shipments/${s.id}`
  const excHistory = exceptionMilestones(s)

  return (
    <Page>
      {/* header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Button asChild variant="ghost" size="icon" className="-ml-1 mt-px shrink-0" aria-label="Back to shipments"><Link to="/shipments"><ArrowLeft /></Link></Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold leading-tight tracking-tight">{s.trackingRef}</h1>
              <Tooltip content="Copy tracking reference">
                <Button variant="ghost" size="icon-xs" aria-label="Copy tracking reference" onClick={() => void copyText(s.trackingRef, 'Tracking reference')}><Copy /></Button>
              </Tooltip>
              <Status kind="shipment" value={s.status} pulse={open} />
              {overdue && <Badge tone="danger">Overdue</Badge>}
              {s.exception?.resolved && <Badge tone="neutral"><ShieldCheck /> Exception resolved</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
              <CustomerLink id={s.customerId} className="font-medium" />
              <span aria-hidden>·</span>
              <span className="truncate">{s.cargoDescription}</span>
              <span aria-hidden>·</span>
              <span>registered {timeAgo(s.createdAt)}</span>
              <span aria-hidden>·</span>
              <BranchLink id={s.branchId} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {next && <Button onClick={next.run}>{next.label}</Button>}
          <Button variant="outline" onClick={() => void copyText(trackingUrl, 'Tracking link')}><Link2 /> <span className="max-sm:hidden">Copy tracking link</span><span className="sm:hidden">Link</span></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {actions.can.edit && canAllocate(s) && <DropdownMenuItem onSelect={() => actions.allocate(s)}><Truck /> {s.vehicleId ? 'Change vehicle & driver' : 'Allocate vehicle & driver'}</DropdownMenuItem>}
              {actions.can.edit && canUpdateStatus(s) && <DropdownMenuItem onSelect={() => actions.updateStatus(s)}><ClipboardCheck /> Update status</DropdownMenuItem>}
              {actions.can.edit && canCapturePod(s) && <DropdownMenuItem onSelect={() => actions.capturePod(s)}><CheckCircle2 /> Capture proof of delivery</DropdownMenuItem>}
              {actions.can.edit && canRaiseException(s) && <DropdownMenuItem onSelect={() => actions.raiseException(s)}><TriangleAlert /> Raise exception</DropdownMenuItem>}
              {actions.can.edit && open && <DropdownMenuItem onSelect={() => actions.resolveException(s)}><ShieldCheck /> Resolve exception</DropdownMenuItem>}
              {actions.can.edit && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => actions.edit(s)}><Pencil /> Edit shipment</DropdownMenuItem></>}
              {actions.can.delete && <DropdownMenuItem destructive onSelect={() => void actions.remove(s).then((ok) => ok && nav('/shipments', { replace: true }))}><Trash2 /> Delete shipment</DropdownMenuItem>}
              {!actions.can.edit && !actions.can.delete && <DropdownMenuItem onSelect={() => void copyText(s.trackingRef, 'Tracking reference')}><Copy /> Copy reference</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* delivery timeline */}
      <Panel
        title="Delivery timeline"
        description={delivered ? `Delivered ${fmtDateTime(s.deliveredAt)}` : `${s.pickup.city} → ${s.delivery.city} · ETA ${fmtDateTime(etaTs)}`}
        className="mb-3"
        bodyClassName="px-3.5 py-4"
      >
        <DeliveryStepper shipment={s} />
        {open && s.exception && (
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-danger">{s.exception.type} <span className="font-normal text-muted-foreground">· raised {timeAgo(s.exception.raisedAt)}</span></p>
                <p className="mt-0.5 text-muted-foreground">{s.exception.description}</p>
              </div>
            </div>
            {actions.can.edit && <Button size="sm" variant="outline" onClick={() => actions.resolveException(s)}><ShieldCheck /> Resolve</Button>}
          </div>
        )}
      </Panel>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="log">Tracking log <span className="num rounded bg-surface-3 px-1 text-[11px] text-muted-foreground">{stageMilestones(s).filter((m) => m.at).length + excHistory.length}</span></TabsTrigger>
          <TabsTrigger value="trip">Trip & costs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
              <Panel
                title="Route & live position"
                description={route ? `${route.name} · ${route.road}` : `Direct distance ${fmtKm(directKm)} — no trip routed yet`}
                actions={onTrip ? <Status kind="live" value={tel!.state} /> : trip ? <Status kind="trip" value={trip.status} /> : undefined}
                flush
              >
                <MiniMap height={340} markers={markers} routeId={trip?.routeId} routeDir={trip?.routeDir} progressM={progressM} vehicleId={!delivered && s.vehicleId ? s.vehicleId : undefined} className="rounded-none border-0" />
                <div className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-4 sm:divide-y-0">
                  <Stat icon={RouteIcon} label="Route distance" value={trip ? fmtKm(trip.plannedDistanceKm, 1) : `~${fmtKm(directKm)}`} />
                  <Stat icon={Navigation} label="Remaining" value={onTrip ? fmtKm(tel!.remainingKm, 1) : delivered ? 'Arrived' : '—'} />
                  <Stat icon={Gauge} label="Speed" value={onTrip ? `${Math.round(tel!.speedKph)} km/h` : '—'} />
                  <Stat icon={Clock} label={delivered ? 'Delivered' : onTrip ? 'Live ETA' : 'Planned ETA'} value={fmtDateTime(delivered ? s.deliveredAt : etaTs)} tone={overdue ? 'danger' : undefined} />
                </div>
                {tel && !delivered && (
                  <p className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{vehicle?.reg}</span> {LIVE_STATE[tel.state].label.toLowerCase()} · {tel.location} · fuel {Math.round(tel.fuelPct)}%
                  </p>
                )}
              </Panel>

              <Panel title="Cargo & charge">
                <DetailGrid
                  columns={3}
                  items={[
                    { label: 'Cargo type', value: cargoLabel(s.cargoType) },
                    { label: 'Description', value: s.cargoDescription },
                    { label: 'Weight', value: fmtWeight(s.weightKg) },
                    { label: 'Packages', value: fmtNumber(s.packages) },
                    { label: 'Declared value', value: <span className="num">{money(s.declaredValueUsd)}</span> },
                    { label: 'Freight charge', value: <span className="num font-semibold">{money(s.chargeUsd)}</span> },
                    { label: 'Pickup', value: <span title={s.pickup.name}>{s.pickup.name}</span> },
                    { label: 'Pickup window', value: <span className="num">{fmtDateTime(s.pickupWindowStart)}</span> },
                    { label: 'Rate', value: <span className="num">{trip ? `${money(s.chargeUsd / Math.max(1, trip.plannedDistanceKm), { digits: 2 })} / km` : '—'}</span> },
                    { label: 'Delivery', value: <span title={s.delivery.name}>{s.delivery.name}</span> },
                    { label: delivered ? 'Delivered at' : 'Delivery ETA', value: <span className={cn('num', overdue && 'text-danger')}>{fmtDateTime(delivered ? s.deliveredAt : s.deliveryEta)}</span> },
                    { label: 'Priority', value: trip ? <Badge tone={PRIORITY[trip.priority]?.tone}>{PRIORITY[trip.priority]?.label}</Badge> : '—' },
                  ]}
                />
              </Panel>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <Panel
                title="Allocation"
                actions={actions.can.edit && canAllocate(s) ? <Button size="xs" variant="outline" onClick={() => actions.allocate(s)}><Truck /> {s.vehicleId ? 'Change' : 'Allocate'}</Button> : undefined}
              >
                {vehicle || driver || trip ? (
                  <dl className="space-y-2.5 text-[13px]">
                    <Row label="Vehicle">{vehicle ? <span className="flex min-w-0 flex-col items-end text-right leading-tight"><VehicleLink id={vehicle.id} /><span className="text-xs text-muted-foreground">{VEHICLE_CATEGORY[vehicle.category]} · {fmtWeight(vehicle.loadCapacityKg)}</span></span> : '—'}</Row>
                    <Row label="Driver">{driver ? <span className="flex min-w-0 flex-col items-end text-right leading-tight"><DriverLink id={driver.id} avatar /><a href={`tel:${driver.phone}`} className="text-xs text-muted-foreground hover:text-primary">{driver.phone}</a></span> : '—'}</Row>
                    <Row label="Trip">{trip ? <span className="flex items-center gap-2"><TripLink id={trip.id} /><Status kind="trip" value={trip.status} dot={false} /></span> : '—'}</Row>
                    <Row label="Depot"><BranchLink id={s.branchId} /></Row>
                  </dl>
                ) : (
                  <EmptyState compact icon={Truck} title="No vehicle allocated" description="Allocate a vehicle & driver to create or link a trip and start tracking." action={actions.can.edit && canAllocate(s) ? <Button size="sm" onClick={() => actions.allocate(s)}><Truck /> Allocate vehicle</Button> : undefined} className="py-4" />
                )}
              </Panel>

              <Panel title="Customer contact">
                <div className="flex items-center gap-3">
                  <Avatar name={s.contactName} size={36} />
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-[13px] font-medium">{s.contactName}</p>
                    <p className="truncate text-xs text-muted-foreground">{customer?.name}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline"><a href={`tel:${s.contactPhone}`}><Phone /> {s.contactPhone}</a></Button>
                  {customer?.email && <Button asChild size="sm" variant="outline"><a href={`mailto:${customer.email}?subject=${encodeURIComponent(`Shipment ${s.trackingRef}`)}`}><Mail /> Email</a></Button>}
                </div>
              </Panel>

              <Panel title="Proof of delivery" actions={s.pod ? <Badge tone={s.pod.conditionOk ? 'success' : 'warning'}>{s.pod.conditionOk ? 'Good condition' : 'Issue noted'}</Badge> : undefined}>
                {s.pod ? (
                  <div className="space-y-3">
                    <DetailGrid columns={2} items={[{ label: 'Received by', value: s.pod.receivedBy }, { label: 'Signed', value: <span className="num">{fmtDateTime(s.pod.signedAt)}</span> }, { label: 'Photos', value: <span className="inline-flex items-center gap-1"><Camera className="size-3.5 text-muted-foreground" />{s.pod.photoCount}</span> }, { label: 'Condition', value: s.pod.conditionOk ? 'OK' : 'Damaged / short' }]} />
                    {s.pod.notes && <p className="rounded-md bg-surface-2 px-2.5 py-2 text-xs text-muted-foreground">“{s.pod.notes}”</p>}
                  </div>
                ) : (
                  <EmptyState compact icon={CheckCircle2} title="Awaiting delivery" description="Capture the receiver's name, condition and photos to close the shipment." action={actions.can.edit && canCapturePod(s) ? <Button size="sm" variant="outline" onClick={() => actions.capturePod(s)}>Capture POD</Button> : undefined} className="py-4" />
                )}
              </Panel>

              <Panel
                title="Exceptions"
                actions={actions.can.edit ? (open ? <Button size="xs" variant="outline" onClick={() => actions.resolveException(s)}><ShieldCheck /> Resolve</Button> : canRaiseException(s) ? <Button size="xs" variant="outline" onClick={() => actions.raiseException(s)}><TriangleAlert /> Raise</Button> : undefined) : undefined}
              >
                {excHistory.length ? (
                  <ul className="space-y-2.5">
                    {excHistory.map((m, i) => {
                      const resolved = m.label.startsWith('Exception resolved')
                      return (
                        <li key={i} className="flex items-start gap-2 text-[13px]">
                          {resolved ? <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', open && i === excHistory.length - 1 ? 'text-danger' : 'text-warning')} />}
                          <div className="min-w-0">
                            <p className="font-medium leading-tight">{m.label.replace('Exception – ', '').replace('Exception resolved – ', 'Resolved: ')}</p>
                            {m.note && <p className="mt-0.5 text-xs text-muted-foreground">{m.note}</p>}
                            <p className="num mt-0.5 text-[11px] text-subtle-foreground">{fmtDateTime(m.at)}</p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="py-2 text-center text-xs text-muted-foreground">No exceptions raised on this shipment.</p>
                )}
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="log">
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Milestones" description="Lifecycle events with timestamps">
              <MilestoneTable s={s} />
            </Panel>
            <Panel title="System activity" description="Audit trail for this shipment and its trip">
              {audit.length ? (
                <Timeline
                  items={audit.map<TimelineItem>((a) => ({ id: a.id, title: a.summary, description: a.userName, time: fmtDateTime(a.at), tone: a.action === 'delete' ? 'danger' : 'default' }))}
                />
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">No manual changes recorded yet.</p>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="trip">
          {trip ? (
            <div className="grid gap-3 lg:grid-cols-3">
              <Panel title="Linked trip" actions={<TripLink id={trip.id} />} className="lg:col-span-2">
                <DetailGrid
                  columns={3}
                  items={[
                    { label: 'Trip', value: <TripLink id={trip.id} /> },
                    { label: 'Status', value: <Status kind="trip" value={trip.status} /> },
                    { label: 'Route', value: route?.name ?? trip.routeId },
                    { label: 'Scheduled start', value: <span className="num">{fmtDateTime(trip.scheduledStart)}</span> },
                    { label: 'Actual start', value: <span className="num">{fmtDateTime(trip.actualStart)}</span> },
                    { label: 'Planned end', value: <span className="num">{fmtDateTime(trip.plannedEnd)}</span> },
                    { label: 'Distance', value: fmtKm(trip.actualDistanceKm ?? trip.plannedDistanceKm, 1) },
                    { label: 'Duration', value: fmtDuration(trip.actualDurationMin ?? trip.plannedDurationMin) },
                    { label: 'Delay', value: trip.delayMinutes ? <span className="text-danger">{fmtDuration(trip.delayMinutes)}{trip.delayReason ? ` · ${trip.delayReason}` : ''}</span> : 'On schedule' },
                    { label: 'Vehicle', value: <VehicleLink id={trip.vehicleId} /> },
                    { label: 'Driver', value: <DriverLink id={trip.driverId} /> },
                    { label: 'Priority', value: PRIORITY[trip.priority]?.label },
                  ]}
                />
              </Panel>
              <Panel title="Economics">
                <dl className="space-y-2.5 text-[13px]">
                  <Row label="Shipment charge"><span className="num font-medium">{money(s.chargeUsd)}</span></Row>
                  <Row label="Trip revenue"><span className="num">{money(trip.revenueUsd)}</span></Row>
                  <Row label="Trip expenses"><span className="num">{money(trip.expensesUsd)}</span></Row>
                  <div className="border-t border-border pt-2.5">
                    <Row label="Est. margin"><span className={cn('num font-semibold', s.chargeUsd - trip.expensesUsd >= 0 ? 'text-success' : 'text-danger')}>{money(s.chargeUsd - trip.expensesUsd)}</span></Row>
                  </div>
                </dl>
              </Panel>
              <Panel title="Trip expenses" description={`${tripExpenses.length} recorded`} className="lg:col-span-3" flush>
                {tripExpenses.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-subtle-foreground">
                        <tr><th className="px-3.5 py-2 font-medium">Ref</th><th className="px-3.5 py-2 font-medium">Category</th><th className="px-3.5 py-2 font-medium">Description</th><th className="px-3.5 py-2 text-right font-medium">Amount</th><th className="px-3.5 py-2 font-medium">Status</th></tr>
                      </thead>
                      <tbody>
                        {tripExpenses.map((e) => (
                          <tr key={e.id} className="border-t border-border/70">
                            <td className="px-3.5 py-2"><Link className="font-mono text-xs hover:text-primary hover:underline" to={`/finance/expenses?open=${e.id}`}>{e.ref}</Link></td>
                            <td className="px-3.5 py-2 capitalize">{e.category}</td>
                            <td className="px-3.5 py-2 text-muted-foreground">{e.description}</td>
                            <td className="num px-3.5 py-2 text-right">{money(e.amountUsd, { digits: 2 })}</td>
                            <td className="px-3.5 py-2"><Status kind="expense" value={e.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">No expenses have been booked against this trip yet.</p>
                )}
              </Panel>
            </div>
          ) : (
            <div className="panel">
              <EmptyState icon={Truck} title="No trip linked" description="Allocate a vehicle & driver to create a trip (or link an open one) for this shipment." action={actions.can.edit && canAllocate(s) ? <Button size="sm" onClick={() => actions.allocate(s)}><Truck /> Allocate vehicle</Button> : undefined} />
            </div>
          )}
        </TabsContent>
      </Tabs>
      {actions.dialogs}
    </Page>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Gauge; label: string; value: React.ReactNode; tone?: 'danger' }) {
  return (
    <div className="min-w-0 px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground"><Icon className="size-3" />{label}</p>
      <p className={cn('num mt-0.5 truncate text-[13px] font-medium', tone === 'danger' && 'text-danger')}>{value}</p>
    </div>
  )
}

function MilestoneTable({ s }: { s: Shipment }) {
  const stages = stageMilestones(s)
  const rows = [...stages, ...exceptionMilestones(s)].sort((a, b) => (a.at ? new Date(a.at).getTime() : 1e15) - (b.at ? new Date(b.at).getTime() : 1e15))
  let prev: number | null = null
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((m, i) => {
        const ts = m.at ? new Date(m.at).getTime() : null
        const gap = ts !== null && prev !== null ? Math.round((ts - prev) / 6e4) : null
        if (ts !== null) prev = ts
        const isExc = m.key === 'exception'
        return (
          <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className={cn('mt-1 size-2 shrink-0 rounded-full', !m.at ? 'bg-border-strong' : isExc && !m.label.startsWith('Exception resolved') ? 'bg-danger' : 'bg-primary')} />
            <div className="min-w-0 flex-1">
              <p className={cn('text-[13px] font-medium leading-tight', !m.at && 'text-muted-foreground')}>{m.label}</p>
              {m.note && <p className="mt-0.5 text-xs text-muted-foreground">{m.note}</p>}
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-xs">{m.at ? fmtDateTime(m.at) : 'Pending'}</p>
              {gap !== null && gap > 0 && <p className="num text-[11px] text-subtle-foreground">+{fmtDuration(gap)}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

