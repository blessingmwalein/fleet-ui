import { addDays, format, startOfDay } from 'date-fns'
import type {
  Branch, Customer, DailyStat, Driver, Expense, FuelStation, FuelTransaction, Incident, Invoice, SafetyEvent, ServiceProvider, ServiceSchedule, Shipment, Trip, Vehicle, WorkOrder,
} from '@/types'
import type { DbData } from '@/store/db'
import { ROUTE_BY_ID } from '@/data/routes'
import { VEHICLE_CATEGORY, CARGO_TYPE } from '@/config/status'
import type { DateWindow, DimDef, Fact, Sums } from './types'

export const DAY = 864e5
export const HOUR = 36e5
/** A completed trip arriving within this many minutes of plan counts as on time. */
export const ON_TIME_MIN = 15

// ---------------------------------------------------------------------------
// Dataset (branch-scoped view of the database)
// ---------------------------------------------------------------------------
export const SNAPSHOT_KEYS = [
  'vehicles', 'drivers', 'trips', 'fuelTransactions', 'workOrders', 'expenses', 'incidents', 'safetyEvents', 'shipments', 'invoices', 'customers', 'branches',
  'providers', 'fuelStations', 'schedules', 'budgets', 'dailyStats',
] as const
export type Snapshot = Pick<DbData, (typeof SNAPSHOT_KEYS)[number]>

export interface Dataset {
  now: number
  branchId: string
  all: Snapshot
  vehicles: Vehicle[]
  drivers: Driver[]
  trips: Trip[]
  fuel: FuelTransaction[]
  workOrders: WorkOrder[]
  expenses: Expense[]
  incidents: Incident[]
  events: SafetyEvent[]
  shipments: Shipment[]
  schedules: ServiceSchedule[]
  vehicleById: Map<string, Vehicle>
  driverById: Map<string, Driver>
  customerById: Map<string, Customer>
  branchById: Map<string, Branch>
  providerById: Map<string, ServiceProvider>
  stationById: Map<string, FuelStation>
  tripById: Map<string, Trip>
  dailyStats: DailyStat[]
}

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))

export function makeDataset(snap: Snapshot, branchId: string, now: number): Dataset {
  const scope = <T extends { branchId?: string }>(xs: T[]): T[] => (branchId === 'all' ? xs : xs.filter((x) => x.branchId === branchId))
  const vehicles = scope(snap.vehicles)
  const vehicleIds = new Set(vehicles.map((v) => v.id))
  return {
    now,
    branchId,
    all: snap,
    vehicles,
    drivers: scope(snap.drivers),
    trips: scope(snap.trips),
    fuel: scope(snap.fuelTransactions),
    workOrders: scope(snap.workOrders),
    expenses: scope(snap.expenses),
    incidents: scope(snap.incidents),
    events: scope(snap.safetyEvents),
    shipments: scope(snap.shipments),
    schedules: branchId === 'all' ? snap.schedules : snap.schedules.filter((s) => vehicleIds.has(s.vehicleId)),
    vehicleById: byId(snap.vehicles),
    driverById: byId(snap.drivers),
    customerById: byId(snap.customers),
    branchById: byId(snap.branches),
    providerById: byId(snap.providers),
    stationById: byId(snap.fuelStations),
    tripById: byId(snap.trips),
    dailyStats: snap.dailyStats,
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
export function makeWindow(from: Date, to: Date, label: string): DateWindow {
  const f = from.getTime()
  const t = to.getTime()
  const span = t - f
  return { from: f, to: t, prevFrom: f - span - 1, prevTo: f - 1, days: Math.max(1, Math.round(span / DAY)), label }
}

export const fmtWindow = (w: { from: number; to: number }) => {
  const a = new Date(w.from)
  const b = new Date(w.to)
  return a.getFullYear() === b.getFullYear() ? `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}` : `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`
}

export interface Win {
  from: number
  to: number
}
export const inWin = (t: number, w: Win) => t >= w.from && t <= w.to
export const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------
export const emptySums = (): Sums => ({ n: 0, m: {}, sets: {}, facts: [] })

export function addFact(s: Sums, f: Fact, distinctDims: string[] | undefined) {
  s.n++
  s.facts.push(f)
  for (const k in f.m) s.m[k] = (s.m[k] ?? 0) + f.m[k]!
  if (distinctDims)
    for (const dim of distinctDims) {
      const v = f.d[dim]
      if (v) (s.sets[dim] ??= new Set()).add(v)
    }
}

export const sumOf = (s: Sums, k: string) => s.m[k] ?? 0
export const distinct = (s: Sums, dim: string) => s.sets[dim]?.size ?? 0
export const ratio = (a: number, b: number, mult = 1): number | null => (b > 0 ? (a / b) * mult : null)

// ---------------------------------------------------------------------------
// Standard fact builders (shared across reports)
// ---------------------------------------------------------------------------
export function vehicleDims(ds: Dataset, vehicleId: string | null | undefined): { vehicle: string; category: string; branch: string } {
  const v = vehicleId ? ds.vehicleById.get(vehicleId) : undefined
  return v ? { vehicle: v.id, category: v.category, branch: v.branchId } : { vehicle: '', category: '', branch: '' }
}

/** One fact per trip with every trip-level measure (reports read only the measures they need). */
export function tripFact(ds: Dataset, t: Trip, time: number): Fact {
  const v = t.vehicleId ? ds.vehicleById.get(t.vehicleId) : undefined
  const done = t.status === 'completed'
  const late = done && t.delayMinutes > ON_TIME_MIN
  const reason = t.delayReason ?? (late ? 'Unspecified delay' : 'On schedule')
  return {
    t: time,
    d: {
      vehicle: t.vehicleId ?? '', category: v?.category ?? '', branch: t.branchId, driver: t.driverId ?? '', customer: t.customerId ?? '',
      route: t.routeId, cargo: t.cargoType, reason, priority: t.priority, destCity: t.destination.city, status: t.status,
    },
    m: {
      trips: 1,
      completed: done ? 1 : 0,
      cancelled: t.status === 'cancelled' ? 1 : 0,
      active: t.status === 'in_transit' || t.status === 'delayed' ? 1 : 0,
      delayedNow: t.status === 'delayed' ? 1 : 0,
      km: done ? (t.actualDistanceKm ?? t.plannedDistanceKm) : 0,
      plannedKm: done ? t.plannedDistanceKm : 0,
      hours: done ? (t.actualDurationMin ?? t.plannedDurationMin) / 60 : 0,
      plannedH: done ? t.plannedDurationMin / 60 : 0,
      revenue: done ? t.revenueUsd : 0,
      tripCost: done ? t.expensesUsd : 0,
      onTime: done && !late ? 1 : 0,
      late: late ? 1 : 0,
      delayMin: done ? t.delayMinutes : 0,
      weight: done ? t.cargoWeightKg : 0,
    },
  }
}

/** Completed trips, timed by arrival (when revenue is recognised). */
export function completedTripFacts(ds: Dataset, w: Win): Fact[] {
  const out: Fact[] = []
  for (const t of ds.trips) {
    if (t.status !== 'completed' || !t.actualEnd) continue
    const at = Date.parse(t.actualEnd)
    if (inWin(at, w)) out.push(tripFact(ds, t, at))
  }
  return out
}

export const woTime = (wo: WorkOrder): number | null => {
  if (wo.status === 'completed') return ts(wo.completedAt ?? wo.scheduledDate)
  if (wo.status === 'in_progress') return ts(wo.startedAt ?? wo.scheduledDate)
  return null
}

export const woCost = (wo: WorkOrder) => wo.labourCostUsd + wo.partsCostUsd
const WO_REACTIVE = new Set(['corrective', 'breakdown', 'accident_repair'])
export const isReactive = (t: WorkOrder['type']) => WO_REACTIVE.has(t)

/** Downtime hours attributable to a work order inside a window. */
export function woDowntimeH(wo: WorkOrder, now: number): number {
  if (wo.status === 'completed') return wo.downtimeHours
  if (wo.status === 'in_progress' && wo.startedAt) return Math.max(0, (now - Date.parse(wo.startedAt)) / HOUR)
  return 0
}

export const EXPENSE_BUCKET: Record<string, 'fuelCost' | 'maintCost' | 'otherCost'> = {
  fuel: 'fuelCost', maintenance: 'maintCost', tyres: 'maintCost',
}

/** Fuel + workshop + other expense claims as cost facts (`fuelCost`, `maintCost`, `otherCost`). */
export function costFacts(ds: Dataset, w: Win): Fact[] {
  const out: Fact[] = []
  for (const f of ds.fuel) {
    const t = Date.parse(f.date)
    if (!inWin(t, w)) continue
    out.push({ t, d: { ...vehicleDims(ds, f.vehicleId), branch: f.branchId, driver: f.driverId ?? '' }, m: { fuelCost: f.totalUsd, litres: f.litres } })
  }
  for (const wo of ds.workOrders) {
    const t = woTime(wo)
    if (t === null || Number.isNaN(t) || !inWin(t, w)) continue
    out.push({ t, d: { ...vehicleDims(ds, wo.vehicleId), branch: wo.branchId, driver: '' }, m: { maintCost: woCost(wo) } })
  }
  for (const e of ds.expenses) {
    if (e.status === 'rejected') continue
    const t = Date.parse(e.date)
    if (!inWin(t, w)) continue
    out.push({ t, d: { ...vehicleDims(ds, e.vehicleId), branch: e.branchId, driver: e.driverId ?? '' }, m: { [EXPENSE_BUCKET[e.category] ?? 'otherCost']: e.amountUsd } })
  }
  return out
}

/** One fact per vehicle per day: availability (after workshop downtime) and trip activity. */
export function vehicleDayFacts(ds: Dataset, w: Win): Fact[] {
  const out: Fact[] = []
  const last = Math.min(w.to, ds.now)
  const days: number[] = []
  for (let d = startOfDay(w.from); d.getTime() <= last; d = addDays(d, 1)) days.push(d.getTime())
  if (!days.length) return out

  const first = days[0]!
  const tripsByVD = new Map<string, Trip[]>()
  for (const t of ds.trips) {
    if (!t.vehicleId || (t.status !== 'completed' && t.status !== 'in_transit' && t.status !== 'delayed')) continue
    const st = Date.parse(t.actualStart ?? t.scheduledStart)
    if (st < first || st > w.to) continue
    const key = `${t.vehicleId}|${startOfDay(st).getTime()}`
    const list = tripsByVD.get(key)
    if (list) list.push(t)
    else tripsByVD.set(key, [t])
  }

  const downtime = new Map<string, [number, number][]>()
  for (const wo of ds.workOrders) {
    let a: number
    let b: number
    if (wo.status === 'completed') {
      a = ts(wo.startedAt ?? wo.scheduledDate)
      b = a + wo.downtimeHours * HOUR
    } else if (wo.status === 'in_progress' && wo.startedAt) {
      a = ts(wo.startedAt)
      b = ds.now
    } else continue
    if (Number.isNaN(a) || b < first || a > w.to) continue
    const list = downtime.get(wo.vehicleId)
    if (list) list.push([a, b])
    else downtime.set(wo.vehicleId, [[a, b]])
  }

  for (const v of ds.vehicles) {
    if (v.status === 'out_of_service') continue
    const bought = ts(v.purchaseDate)
    const dims = { vehicle: v.id, category: v.category, branch: v.branchId, driver: v.driverId ?? '' }
    const ivs = downtime.get(v.id)
    for (const day of days) {
      if (bought > day + DAY) continue
      let down = 0
      if (ivs) for (const [a, b] of ivs) down += Math.max(0, Math.min(b, day + DAY) - Math.max(a, day))
      const downFrac = Math.min(1, down / DAY)
      const tr = tripsByVD.get(`${v.id}|${day}`)
      let km = 0
      let hours = 0
      let completed = 0
      if (tr)
        for (const t of tr)
          if (t.status === 'completed') {
            completed++
            km += t.actualDistanceKm ?? t.plannedDistanceKm
            hours += (t.actualDurationMin ?? t.plannedDurationMin) / 60
          }
      out.push({
        t: day,
        d: dims,
        m: { availDays: 1 - downFrac, downH: downFrac * 24, activeDays: tr ? 1 : 0, vdTrips: tr?.length ?? 0, vdCompleted: completed, km, hours },
      })
    }
  }
  return out
}

/**
 * Customer-invoice facts. A branch filter apportions each invoice by the revenue its trips earned in that branch
 * (all invoices are raised from head office in the seed data).
 */
export function invoiceShare(ds: Dataset, inv: Invoice): { branch: string; share: number }[] {
  const shares = new Map<string, number>()
  let total = 0
  for (const id of inv.tripIds) {
    const t = ds.tripById.get(id)
    if (!t) continue
    shares.set(t.branchId, (shares.get(t.branchId) ?? 0) + t.revenueUsd)
    total += t.revenueUsd
  }
  if (!total) return [{ branch: inv.branchId, share: 1 }]
  return [...shares.entries()].map(([branch, rev]) => ({ branch, share: rev / total }))
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------
const UNALLOCATED = { label: 'Unallocated' }

export const DIM_VEHICLE: DimDef = {
  value: 'vehicle', label: 'Vehicle',
  resolve: (ds, k) => {
    const v = ds.vehicleById.get(k)
    return v ? { label: v.reg, entity: { type: 'vehicle', id: k }, sub: `${v.make} ${v.model}` } : { label: 'Unallocated / fleet-level' }
  },
}
export const DIM_CATEGORY: DimDef = {
  value: 'category', label: 'Vehicle category',
  resolve: (_ds, k) => (k && k in VEHICLE_CATEGORY ? { label: VEHICLE_CATEGORY[k as keyof typeof VEHICLE_CATEGORY] } : UNALLOCATED),
}
export const DIM_BRANCH: DimDef = {
  value: 'branch', label: 'Depot',
  resolve: (ds, k) => {
    const b = ds.branchById.get(k)
    return b ? { label: b.name, entity: { type: 'branch', id: k }, sub: b.city } : UNALLOCATED
  },
}
export const DIM_DRIVER: DimDef = {
  value: 'driver', label: 'Driver',
  resolve: (ds, k) => {
    const d = ds.driverById.get(k)
    return d ? { label: d.name, entity: { type: 'driver', id: k }, sub: d.empNo } : { label: 'Unassigned' }
  },
}
export const DIM_CUSTOMER: DimDef = {
  value: 'customer', label: 'Customer',
  resolve: (ds, k) => {
    const c = ds.customerById.get(k)
    return c ? { label: c.name, entity: { type: 'customer', id: k }, sub: c.city } : { label: 'Walk-in / internal' }
  },
}
export const DIM_ROUTE: DimDef = {
  value: 'route', label: 'Route',
  resolve: (_ds, k) => {
    const r = ROUTE_BY_ID[k]
    return r ? { label: r.name, sub: r.kind === 'highway' ? r.road : 'City delivery' } : UNALLOCATED
  },
}
export const DIM_CARGO: DimDef = {
  value: 'cargo', label: 'Cargo type',
  resolve: (_ds, k) => (k in CARGO_TYPE ? { label: CARGO_TYPE[k as keyof typeof CARGO_TYPE] } : UNALLOCATED),
}
export const DIM_DEST: DimDef = { value: 'destCity', label: 'Destination', resolve: (_ds, k) => (k ? { label: k } : UNALLOCATED) }

export const PERIOD_DIM: DimDef = { value: 'period', label: 'Period', resolve: (_ds, k) => ({ label: k }) }

export const pickTop = <T>(xs: T[], n: number, key: (x: T) => number) => [...xs].sort((a, b) => key(b) - key(a)).slice(0, n)
export const round = (n: number, d = 2) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}
