import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { ArrowRight, Camera, CheckCircle2, CircleAlert, ClipboardList, Flag, GripVertical, LayoutGrid, List, MapPin, Package, Plus, Search, Send, Timer, Truck, UserPlus, Users, X } from 'lucide-react'
import type { Trip, TripStatus, VehicleCategory } from '@/types'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { useById } from '@/hooks/useLookup'
import { useBranchScope } from '@/hooks/useFilters'
import { useCustomerOptions } from '@/hooks/useOptions'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Badge, Avatar, StatusDot } from '@/components/ui/display'
import { Input } from '@/components/ui/form-controls'
import { Combobox } from '@/components/ui/command'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Segmented } from '@/components/ui/segmented'
import { Page, PageHeader, Can } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { DriverLink, VehicleLink } from '@/components/shared/EntityLink'
import { CARGO_TYPE, TRIP_STATUS, VEHICLE_CATEGORY } from '@/config/status'
import { fmtTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BOARD_COLUMNS, PRIORITY_RANK, isActive, isOnTime, isOpen, isTerminal, startOverdueMin } from './tripLogic'
import { openAssign, openTripForm, planTransition, requestStatus } from './tripStore'
import { DelayChip, PriorityBadge, TripMenu, TripProgressBar, useTripDeepLinks, useTripPerms, type TripPerms } from './tripUi'

const COLUMN_HINT: Record<TripStatus, string> = {
  scheduled: 'Crew assigned · starts later',
  awaiting_assignment: 'Needs a vehicle and driver',
  ready: 'Cleared to depart',
  in_transit: 'On the road now',
  delayed: 'Running behind plan',
  completed: 'Latest deliveries',
  cancelled: 'Latest cancellations',
}
const CLOSED_LIMIT = 15

interface CardData {
  trip: Trip
  reg: string
  driverName: string
  customerName: string
}

/* ----------------------------------------------------------------------------------------------- *
 * Card
 * ----------------------------------------------------------------------------------------------- */
function TripCardView({ data, perms, dragging, overlay }: { data: CardData; perms: TripPerms; dragging?: boolean; overlay?: boolean }) {
  const { trip, reg, driverName, customerName } = data
  const openTrip = useUi((s) => s.openTrip)
  const overdue = startOverdueMin(trip)
  const edge = trip.priority === 'urgent' ? 'border-l-2 border-l-danger' : trip.priority === 'high' ? 'border-l-2 border-l-warning' : ''
  const missing = !trip.vehicleId && !trip.driverId ? 'vehicle & driver' : !trip.vehicleId ? 'vehicle' : 'driver'
  return (
    <div
      onClick={() => openTrip(trip.id)}
      className={cn(
        'group/card relative cursor-pointer rounded-lg border border-border bg-card p-2.5 text-[13px] shadow-xs transition-[border-color,box-shadow,opacity] hover:border-border-strong',
        edge, dragging && 'opacity-35', overlay && 'rotate-[1.2deg] cursor-grabbing shadow-pop ring-1 ring-primary/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {perms.edit && trip.status !== 'completed' && <GripVertical className="-ml-1 size-3.5 shrink-0 text-subtle-foreground/60 max-sm:hidden" aria-hidden />}
          <span className="num truncate text-[12.5px] font-semibold">{trip.ref}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PriorityBadge priority={trip.priority} />
          {!overlay && <TripMenu trip={trip} perms={perms} className="-mr-1" />}
        </div>
      </div>

      <div className="mt-1.5 space-y-0.5 text-[12.5px]">
        <div className="flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full bg-primary" /><span className="truncate">{trip.origin.name}</span></div>
        <div className="flex items-center gap-1.5"><MapPin className="size-3 shrink-0 text-danger" /><span className="truncate">{trip.destination.name}</span></div>
      </div>
      <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
        <Package className="size-3 shrink-0" />
        <span className="truncate">{CARGO_TYPE[trip.cargoType]} · {(trip.cargoWeightKg / 1000).toFixed(1)} t{customerName && ` · ${customerName}`}</span>
      </p>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        {trip.vehicleId ? <VehicleLink id={trip.vehicleId} /> : <Badge tone="warning"><Truck /> No vehicle</Badge>}
        {trip.driverId ? (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><Avatar name={driverName || '?'} size={18} /><DriverLink id={trip.driverId} className="truncate text-muted-foreground" /></span>
        ) : (
          <Badge tone="warning"><Users /> No driver</Badge>
        )}
      </div>
      <span className="sr-only">{reg}</span>

      <div className="mt-2">
        {isActive(trip.status) && (
          <div className="space-y-1.5">
            <TripProgressBar trip={trip} />
            {trip.delayMinutes > 0 && (
              <div className="flex items-center gap-1.5"><DelayChip minutes={trip.delayMinutes} /><span className="truncate text-[11px] text-muted-foreground">{trip.delayReason}</span></div>
            )}
          </div>
        )}
        {(trip.status === 'scheduled' || trip.status === 'ready') && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted-foreground">
            <span className="num inline-flex items-center gap-1"><Timer className="size-3" /> {new Date(trip.scheduledStart).getTime() > Date.now() ? 'Starts' : 'Was due'} {fmtTime(trip.scheduledStart)} · {timeAgo(trip.scheduledStart)}</span>
            {overdue > 0 && <Badge tone="danger"><CircleAlert /> Overdue</Badge>}
          </div>
        )}
        {trip.status === 'awaiting_assignment' && (
          <div className="flex items-center justify-between gap-2">
            <span className="num inline-flex items-center gap-1 text-xs text-muted-foreground" title={`Needs ${missing}`}><Timer className="size-3" /> Starts {fmtTime(trip.scheduledStart)} · {timeAgo(trip.scheduledStart)}</span>
            {perms.edit && !overlay && (
              <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); openAssign([trip.id]) }}>
                <UserPlus /> Assign
              </Button>
            )}
          </div>
        )}
        {trip.status === 'completed' && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-3 text-primary" /> Delivered {timeAgo(trip.actualEnd)}</span>
            <span className="flex items-center gap-1.5">{trip.pod && <Camera className="size-3" aria-label="Proof of delivery captured" />}<Badge tone={isOnTime(trip) ? 'success' : 'warning'}>{isOnTime(trip) ? 'On time' : `+${trip.delayMinutes}m`}</Badge></span>
          </div>
        )}
        {trip.status === 'cancelled' && <p className="truncate text-xs text-muted-foreground">{trip.delayReason ?? 'Cancelled'}</p>}
      </div>
    </div>
  )
}

const DraggableCard = React.memo(function DraggableCard({ data, perms }: { data: CardData; perms: TripPerms }) {
  const enabled = perms.edit && data.trip.status !== 'completed'
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: data.trip.id, disabled: !enabled })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-label={`${data.trip.ref}, ${TRIP_STATUS[data.trip.status].label}`} className={cn('touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg', enabled && 'cursor-grab')}>
      <TripCardView data={data} perms={perms} dragging={isDragging} />
    </div>
  )
})

/* ----------------------------------------------------------------------------------------------- *
 * Column
 * ----------------------------------------------------------------------------------------------- */
function BoardColumn({ status, items, total, activeTrip, perms }: { status: TripStatus; items: CardData[]; total: number; activeTrip: Trip | null; perms: TripPerms }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = TRIP_STATUS[status]
  const plan = activeTrip ? planTransition(activeTrip, status) : null
  const closed = status === 'completed' || status === 'cancelled'
  const state = !plan || plan.mode === 'same' ? 'idle' : plan.mode === 'blocked' ? 'blocked' : 'valid'
  return (
    <section
      ref={setNodeRef}
      aria-label={`${meta.label} column`}
      className={cn(
        'flex h-full w-[84vw] max-w-[310px] shrink-0 snap-start flex-col rounded-lg border bg-surface-2/50 transition-colors sm:w-[292px]',
        state === 'idle' && 'border-border',
        state === 'valid' && (isOver ? 'border-primary bg-primary/8 ring-1 ring-primary/60' : 'border-primary/30'),
        state === 'blocked' && (isOver ? 'border-danger bg-danger/8 ring-1 ring-danger/60' : 'border-danger/25 opacity-70'),
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5" title={COLUMN_HINT[status]}>
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot tone={meta.tone === 'outline' ? 'neutral' : meta.tone} pulse={status === 'delayed' && total > 0} />
          <h2 className="truncate text-[13px] font-semibold">{meta.label}</h2>
        </div>
        <Badge tone="neutral" className="num px-1.5">{total}</Badge>
      </header>
      {isOver && plan && plan.mode !== 'same' && (
        <div className={cn('border-b px-3 py-1.5 text-[11px] font-medium', plan.mode === 'blocked' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-primary/30 bg-primary/10 text-primary')}>
          {plan.mode === 'blocked' ? plan.reason : `Drop to: ${plan.label}${plan.mode === 'dialog' ? ' (confirmation needed)' : ''}`}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-subtle-foreground">
            <ClipboardList className="size-4" /> No trips
          </div>
        ) : (
          items.map((d) => <DraggableCard key={d.trip.id} data={d} perms={perms} />)
        )}
      </div>
      {closed && total > items.length && (
        <footer className="border-t border-border px-3 py-2 text-xs">
          <Link to={`/trips?status=${status}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            View all {total.toLocaleString('en-US')} in Trips <ArrowRight className="size-3" />
          </Link>
        </footer>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------------------------------------- *
 * Page
 * ----------------------------------------------------------------------------------------------- */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}

export default function DispatchPage() {
  useTripDeepLinks()
  const navigate = useNavigate()
  const perms = useTripPerms()
  const money = useMoney()
  const { scope } = useBranchScope()
  const trips = useDb((s) => s.trips)
  const getVehicle = useById('vehicles')
  const getDriver = useById('drivers')
  const getCustomer = useById('customers')
  const customerOptions = useCustomerOptions()
  const [search, setSearch] = React.useState('')
  const [priority, setPriority] = React.useState('all')
  const [category, setCategory] = React.useState('all')
  const [customerId, setCustomerId] = React.useState<string | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const scoped = React.useMemo(() => scope(trips), [scope, trips])
  const filtersOn = !!search.trim() || priority !== 'all' || category !== 'all' || !!customerId

  const { columns, totals } = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const build = (t: Trip): CardData => ({ trip: t, reg: getVehicle(t.vehicleId)?.reg ?? '', driverName: getDriver(t.driverId)?.name ?? '', customerName: getCustomer(t.customerId)?.name ?? '' })
    const matches = (t: Trip, d: CardData) => {
      if (priority !== 'all' && t.priority !== priority) return false
      if (customerId && t.customerId !== customerId) return false
      if (category !== 'all' && getVehicle(t.vehicleId)?.category !== (category as VehicleCategory)) return false
      if (!q) return true
      return `${t.ref} ${t.origin.name} ${t.destination.name} ${t.cargoDescription} ${d.reg} ${d.driverName} ${d.customerName}`.toLowerCase().includes(q)
    }
    const cols = new Map<TripStatus, CardData[]>(BOARD_COLUMNS.map((s) => [s, []]))
    for (const t of scoped) {
      if (isTerminal(t.status) && !filtersOn && cols.get(t.status)!.length > 400) continue
      const d = build(t)
      if (matches(t, d)) cols.get(t.status)!.push(d)
    }
    const tot = {} as Record<TripStatus, number>
    for (const s of BOARD_COLUMNS) {
      const list = cols.get(s)!
      tot[s] = list.length
      if (s === 'completed' || s === 'cancelled') {
        list.sort((a, b) => (b.trip.actualEnd ?? b.trip.scheduledStart).localeCompare(a.trip.actualEnd ?? a.trip.scheduledStart))
        cols.set(s, list.slice(0, CLOSED_LIMIT))
      } else if (s === 'in_transit' || s === 'delayed') list.sort((a, b) => a.trip.plannedEnd.localeCompare(b.trip.plannedEnd))
      else if (s === 'awaiting_assignment') list.sort((a, b) => PRIORITY_RANK[b.trip.priority] - PRIORITY_RANK[a.trip.priority] || a.trip.scheduledStart.localeCompare(b.trip.scheduledStart))
      else list.sort((a, b) => a.trip.scheduledStart.localeCompare(b.trip.scheduledStart))
    }
    return { columns: cols, totals: tot }
  }, [scoped, search, priority, category, customerId, filtersOn, getVehicle, getDriver, getCustomer])

  // KPI strip (not affected by the board filters)
  const kpi = React.useMemo(() => {
    const now = Date.now()
    const todayStart = new Date().setHours(0, 0, 0, 0)
    let transit = 0, delayed = 0, awaiting = 0, urgentAwaiting = 0, ready = 0, next48 = 0, doneToday = 0, done30 = 0, onTime30 = 0, revenueLive = 0
    for (const t of scoped) {
      switch (t.status) {
        case 'in_transit': transit++; revenueLive += t.revenueUsd; break
        case 'delayed': transit++; delayed++; revenueLive += t.revenueUsd; break
        case 'awaiting_assignment': awaiting++; if (t.priority === 'urgent' || t.priority === 'high') urgentAwaiting++; break
        case 'ready': ready++; break
        case 'scheduled': if (new Date(t.scheduledStart).getTime() - now < 48 * 36e5) next48++; break
        case 'completed': {
          const end = t.actualEnd ? new Date(t.actualEnd).getTime() : 0
          if (end >= todayStart) doneToday++
          if (end >= now - 30 * 864e5) { done30++; if (isOnTime(t)) onTime30++ }
          break
        }
        default: break
      }
    }
    return { transit, delayed, awaiting, urgentAwaiting, ready, next48, doneToday, onTimePct: done30 ? (onTime30 / done30) * 100 : 0, revenueLive }
  }, [scoped])

  const activeTrip = activeId ? (trips.find((t) => t.id === activeId) ?? null) : null
  const activeData = activeId ? [...columns.values()].flat().find((d) => d.trip.id === activeId) : undefined

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    if (!e.over) return
    void requestStatus(String(e.active.id), e.over.id as TripStatus)
  }

  const reset = () => { setSearch(''); setPriority('all'); setCategory('all'); setCustomerId(null) }

  return (
    <Page>
      <PageHeader
        title="Dispatch board"
        description="Drag trips between columns to assign, dispatch, delay, complete or cancel. Vehicle and driver checks run before every move."
        actions={
          <>
            <Segmented
              aria-label="View"
              size="md"
              value="board"
              onChange={(v) => v === 'list' && navigate('/trips')}
              options={[
                { value: 'board', label: <><LayoutGrid className="size-3.5" /> Board</> },
                { value: 'list', label: <><List className="size-3.5" /> List</> },
              ]}
            />
            <Can perm="dispatch.create">
              <Button onClick={() => openTripForm()}><Plus /> New trip</Button>
            </Can>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="In transit" value={kpi.transit} icon={Truck} status={kpi.delayed ? 'warning' : 'success'} hint={`${kpi.delayed} delayed`} href="/trips?status=in_transit,delayed" />
        <KpiCard label="Delayed" value={kpi.delayed} icon={Timer} status={kpi.delayed ? 'danger' : 'success'} href="/trips?status=delayed" />
        <KpiCard label="Awaiting assignment" value={kpi.awaiting} icon={UserPlus} status={kpi.urgentAwaiting ? 'danger' : kpi.awaiting ? 'warning' : 'success'} hint={`${kpi.urgentAwaiting} high / urgent priority`} href="/trips?status=awaiting_assignment" />
        <KpiCard label="Ready for dispatch" value={kpi.ready} icon={Send} status="info" href="/trips?status=ready" />
        <KpiCard label="On-time delivery" value={`${kpi.onTimePct.toFixed(0)}%`} icon={Flag} status={kpi.onTimePct >= 85 ? 'success' : 'warning'} hint="Completed in the last 30 days, within 15 min of plan" />
        <KpiCard label="Delivered today" value={kpi.doneToday} icon={CheckCircle2} hint={`${kpi.next48} scheduled in the next 48h · ${money(kpi.revenueLive, { compact: true })} revenue on the road`} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ref, route, vehicle, driver…" className="pl-8" aria-label="Search trips" />
        </div>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger size="sm" className="w-36" aria-label="Priority filter"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" className="w-40" aria-label="Vehicle category filter"><SelectValue placeholder="Vehicle category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vehicle types</SelectItem>
            {Object.entries(VEHICLE_CATEGORY).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="w-48"><Combobox options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="All customers" searchPlaceholder="Search customers…" clearable className="h-7 text-xs" /></div>
        {filtersOn && <Button variant="ghost" size="sm" onClick={reset}><X /> Reset</Button>}
        <span className="num ml-auto text-xs text-muted-foreground max-sm:hidden">{BOARD_COLUMNS.filter((s) => isOpen(s)).reduce((n, s) => n + totals[s], 0)} open trips</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-3 snap-x overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4 lg:-mx-5 lg:px-5" data-testid="dispatch-board">
          <div className="flex gap-3" style={{ height: 'max(460px, calc(100dvh - 345px))' }}>
            {BOARD_COLUMNS.map((s) => (
              <BoardColumn key={s} status={s} items={columns.get(s)!} total={totals[s]} activeTrip={activeTrip} perms={perms} />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{activeData && <div className="w-[272px]"><TripCardView data={activeData} perms={perms} overlay /></div>}</DragOverlay>
      </DndContext>
    </Page>
  )
}
