import type { Customer, ID, Place, Shipment, ShipmentStatus, Telemetry, Trip, TripStatus, VehicleCategory } from '@/types'
import { ROUTE_BY_ID, routeEndpoints, type Route } from '@/data/routes'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { haversineM } from '@/lib/geo'
import { fmtDate, fmtDateTime, fmtDuration } from '@/lib/format'
import { clamp } from '@/lib/utils'
import { DOCUMENT_TYPE, DRIVER_STATUS, TRIP_STATUS, VEHICLE_STATUS, expiryState } from '@/config/status'

/* -------------------------------------------------------------------------------------------------
 * Trip domain logic (no React): status groups, route helpers, assignment validation and every mutation
 * that goes through the dispatch workflow. UI layers call these after collecting input from dialogs.
 * ------------------------------------------------------------------------------------------------- */

export const BOARD_COLUMNS: TripStatus[] = ['scheduled', 'awaiting_assignment', 'ready', 'in_transit', 'delayed', 'completed', 'cancelled']
export const OPEN_STATUSES: TripStatus[] = ['scheduled', 'awaiting_assignment', 'ready', 'in_transit', 'delayed']
export const DRAFT_STATUSES: TripStatus[] = ['awaiting_assignment', 'scheduled', 'ready']

export const isActive = (s: TripStatus) => s === 'in_transit' || s === 'delayed'
export const isOpen = (s: TripStatus) => OPEN_STATUSES.includes(s)
export const isDraft = (s: TripStatus) => DRAFT_STATUSES.includes(s)
export const isTerminal = (s: TripStatus) => s === 'completed' || s === 'cancelled'

export const PRIORITY_RANK: Record<Trip['priority'], number> = { urgent: 3, high: 2, normal: 1, low: 0 }

export const DELAY_REASONS = [
  'Heavy traffic',
  'Road works – single lane',
  'Border congestion at Beitbridge',
  'Mechanical issue – reduced speed',
  'Tyre puncture – roadside repair',
  'Heavy rain / flooded low-level bridge',
  'Roadside inspection (VID / police)',
  'Customer not ready to receive',
  'Driver rest stop – fatigue management',
  'Other',
]

export const CANCEL_REASONS = [
  'Customer cancelled order',
  'Cargo not ready at pickup',
  'Vehicle unavailable – reassigned',
  'Driver unavailable',
  'Duplicate booking',
  'Route closed / unsafe',
  'Other',
]

/* ----------------------------------------------------------------------------------------------- *
 * Route helpers
 * ----------------------------------------------------------------------------------------------- */
const CITY_BY_CODE: Record<string, string> = { HRE: 'Harare', BYO: 'Bulawayo', MUT: 'Mutare', GWE: 'Gweru', KWE: 'Kwekwe', MSV: 'Masvingo', CHI: 'Chinhoyi', BBR: 'Beitbridge' }
export const routeCity = (route: Route) => CITY_BY_CODE[route.id.split('-')[1] ?? ''] ?? 'Harare'

/** Origin / destination places for a route + direction, following the naming convention of the seeded trips. */
export function routePlaces(route: Route, dir: 1 | -1, customer?: Customer | null): { origin: Place; destination: Place } {
  const ep = routeEndpoints(route, dir)
  const make = (end: 'from' | 'to'): Place => {
    const name = end === 'from' ? ep.fromName : ep.toName
    const pt = end === 'from' ? ep.from : ep.to
    const city = route.kind === 'highway' ? name : routeCity(route)
    if (end === 'to' && customer && customer.city === city) return { name: `${customer.name} – ${route.kind === 'city' ? name : city}`, city, lat: pt.lat, lng: pt.lng }
    return { name: route.kind === 'city' ? `${name}, ${city}` : `${city} Depot`, city, lat: pt.lat, lng: pt.lng }
  }
  return { origin: make('from'), destination: make('to') }
}

const AVG_SPEED: Record<VehicleCategory, number> = { heavy_truck: 62, tanker: 60, refrigerated: 68, bus: 72, light_truck: 74, delivery_van: 80, pickup: 84, service: 80, motorcycle: 55 }
const RATE_PER_KM: Record<VehicleCategory, number> = { heavy_truck: 1.6, tanker: 1.85, refrigerated: 1.72, bus: 1.1, light_truck: 1.02, delivery_van: 0.8, pickup: 0.68, service: 0, motorcycle: 0.55 }

export const routeDistanceKm = (route: Route) => Math.round(route.lengthM / 100) / 10
export const defaultDurationMin = (route: Route, category: VehicleCategory = 'heavy_truck') =>
  Math.round(route.kind === 'highway' ? (route.lengthM / 1000 / AVG_SPEED[category]) * 60 + 25 : (route.lengthM / 1000 / 24) * 60 + 35)
export const suggestRevenueUsd = (route: Route, category: VehicleCategory = 'heavy_truck') =>
  Math.round(((route.lengthM / 1000) * (RATE_PER_KM[category] || RATE_PER_KM.light_truck) + (route.kind === 'city' ? 55 : 120)) / 5) * 5

export function nextTripRef(now = new Date()) {
  let max = 10240
  for (const t of useDb.getState().trips) {
    const m = /(\d+)$/.exec(t.ref)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `TRP-${now.getFullYear()}-${String(max + 1).padStart(5, '0')}`
}

/** Status a trip gets once its crew is (or is not) assigned. */
export function deriveStatus(vehicleId: ID | null | undefined, driverId: ID | null | undefined, scheduledStart: string): TripStatus {
  if (!vehicleId || !driverId) return 'awaiting_assignment'
  return new Date(scheduledStart).getTime() - Date.now() <= 4 * 36e5 ? 'ready' : 'scheduled'
}

/* ----------------------------------------------------------------------------------------------- *
 * Derived metrics
 * ----------------------------------------------------------------------------------------------- */
export const tripMargin = (t: Trip) => t.revenueUsd - t.expensesUsd
export const tripMarginPct = (t: Trip) => (t.revenueUsd > 0 ? ((t.revenueUsd - t.expensesUsd) / t.revenueUsd) * 100 : 0)
export const isOnTime = (t: Trip) => t.status === 'completed' && t.delayMinutes <= 15
export const startOverdueMin = (t: Trip) => {
  if (t.status !== 'ready' && t.status !== 'scheduled' && t.status !== 'awaiting_assignment') return 0
  const m = Math.round((Date.now() - new Date(t.scheduledStart).getTime()) / 6e4)
  return m > 15 ? m : 0
}

export interface LiveProgress {
  pct: number
  remainingKm: number | null
  etaTs: number | null
  speed: number | null
  location: string | null
  live: boolean
}

/** Progress of a trip: telemetry when the simulator drives it, otherwise a schedule-based estimate. */
export function liveProgress(trip: Trip, tel?: Telemetry): LiveProgress {
  if (trip.status === 'completed') return { pct: 100, remainingKm: 0, etaTs: null, speed: null, location: null, live: false }
  if (!isActive(trip.status)) return { pct: 0, remainingKm: null, etaTs: null, speed: null, location: null, live: false }
  if (tel && tel.tripId === trip.id && tel.routeLengthM > 0) {
    return { pct: clamp((tel.progressM / tel.routeLengthM) * 100, 0, 100), remainingKm: tel.remainingKm, etaTs: tel.etaTs, speed: tel.gpsOnline ? tel.speedKph : null, location: tel.location, live: tel.gpsOnline }
  }
  const start = new Date(trip.actualStart ?? trip.scheduledStart).getTime()
  const totalMs = (trip.plannedDurationMin + trip.delayMinutes) * 6e4
  const pct = clamp(((Date.now() - start) / totalMs) * 100, 2, 97)
  return { pct, remainingKm: Math.round(trip.plannedDistanceKm * (1 - pct / 100) * 10) / 10, etaTs: start + totalMs, speed: null, location: null, live: false }
}

/* ----------------------------------------------------------------------------------------------- *
 * Assignment / dispatch validation
 * ----------------------------------------------------------------------------------------------- */
export type CheckLevel = 'block' | 'warn' | 'ok'
export interface Check {
  level: CheckLevel
  text: string
}

export interface CheckInput {
  vehicleId?: ID | null
  driverId?: ID | null
  cargoWeightKg?: number
  scheduledStart?: string
  plannedDurationMin?: number
  routeId?: string
  routeDir?: 1 | -1
  excludeTripId?: ID
  /** `dispatch` is stricter: the trip leaves now, so a busy vehicle/driver or an expired licence blocks it. */
  mode: 'assign' | 'dispatch'
}

const windowOf = (t: Trip): [number, number] => {
  const active = isActive(t.status)
  const start = new Date(active ? (t.actualStart ?? t.scheduledStart) : t.scheduledStart).getTime()
  let end = new Date(t.plannedEnd).getTime() + (active ? t.delayMinutes * 6e4 : 0)
  if (active) end = Math.max(end, Date.now() + 30 * 6e4)
  return [start, Math.max(end, start + 30 * 6e4)]
}

export function checkAssignment(i: CheckInput): Check[] {
  const s = useDb.getState()
  const now = Date.now()
  const dispatch = i.mode === 'dispatch'
  const out: Check[] = []
  const vehicle = i.vehicleId ? s.vehicles.find((v) => v.id === i.vehicleId) : undefined
  const driver = i.driverId ? s.drivers.find((d) => d.id === i.driverId) : undefined
  const startMs = dispatch ? now : i.scheduledStart ? new Date(i.scheduledStart).getTime() : now
  const endMs = startMs + (i.plannedDurationMin ?? 0) * 6e4
  const open = s.trips.filter((t) => t.id !== i.excludeTripId && isOpen(t.status))
  const conflictsFor = (field: 'vehicleId' | 'driverId', id: string) =>
    open.filter((t) => {
      if (t[field] !== id) return false
      if (dispatch && isActive(t.status)) return true
      const [a, b] = windowOf(t)
      return a < endMs && startMs < b
    })

  if (vehicle) {
    if (vehicle.status !== 'active') out.push({ level: 'block', text: `${vehicle.reg} is ${VEHICLE_STATUS[vehicle.status].label.toLowerCase()} and cannot take trips` })
    else out.push({ level: 'ok', text: `${vehicle.reg} is active and in service` })
    for (const t of conflictsFor('vehicleId', vehicle.id).slice(0, 2)) {
      if (dispatch && isActive(t.status)) out.push({ level: 'block', text: `${vehicle.reg} is still on ${t.ref} (${TRIP_STATUS[t.status].label.toLowerCase()}). Complete it before dispatching` })
      else out.push({ level: 'warn', text: `${vehicle.reg} overlaps ${t.ref} (${TRIP_STATUS[t.status].label.toLowerCase()}, ${fmtDateTime(windowOf(t)[0])})` })
    }
    const w = i.cargoWeightKg ?? 0
    if (w > 0 && vehicle.loadCapacityKg > 0) {
      const pct = Math.round((w / vehicle.loadCapacityKg) * 100)
      if (w > vehicle.loadCapacityKg) out.push({ level: 'warn', text: `Cargo of ${w.toLocaleString('en-US')} kg exceeds the ${vehicle.loadCapacityKg.toLocaleString('en-US')} kg capacity of ${vehicle.reg} (${pct}%)` })
      else out.push({ level: 'ok', text: `Load is ${pct}% of the ${vehicle.loadCapacityKg.toLocaleString('en-US')} kg capacity` })
    }
    const expired = s.documents.filter((d) => d.entityType === 'vehicle' && d.entityId === vehicle.id && new Date(d.expiryDate).getTime() < startMs)
    for (const d of expired.slice(0, 3)) out.push({ level: 'warn', text: `${vehicle.reg} ${DOCUMENT_TYPE[d.type].toLowerCase()} expired on ${fmtDate(d.expiryDate)}` })
    if (dispatch) {
      const tel = useLive.getState().telemetry[vehicle.id]
      if (tel) {
        if (!tel.gpsOnline) out.push({ level: 'warn', text: `${vehicle.reg} GPS device is offline – its position will not update while on the road` })
        if (tel.fuelPct < 20) out.push({ level: 'warn', text: `${vehicle.reg} fuel is low (${Math.round(tel.fuelPct)}%) – refuel before departure` })
        const route = i.routeId ? ROUTE_BY_ID[i.routeId] : undefined
        if (route) {
          const from = routeEndpoints(route, i.routeDir ?? 1).from
          const km = haversineM({ lat: tel.lat, lng: tel.lng }, from) / 1000
          if (km > 25) out.push({ level: 'warn', text: `${vehicle.reg} is ${Math.round(km).toLocaleString('en-US')} km from the pickup point – expect a positioning leg of about ${fmtDuration((km / 60) * 60)}` })
        }
      }
    }
  }

  if (driver) {
    if (driver.status === 'suspended' || driver.status === 'on_leave') out.push({ level: 'block', text: `${driver.name} is ${DRIVER_STATUS[driver.status].label.toLowerCase()} and cannot be assigned` })
    else if (driver.status === 'off_duty') out.push({ level: 'warn', text: `${driver.name} is currently off duty` })
    const lic = expiryState(driver.licenceExpiry, 30, startMs)
    if (lic.state === 'expired') out.push({ level: dispatch ? 'block' : 'warn', text: `${driver.name}'s licence expired on ${fmtDate(driver.licenceExpiry)}` })
    else if (lic.state === 'expiring') out.push({ level: 'warn', text: `${driver.name}'s licence expires on ${fmtDate(driver.licenceExpiry)} (${lic.days}d after start)` })
    else if (driver.status === 'active') out.push({ level: 'ok', text: `${driver.name} holds a valid ${driver.licenceClass} licence until ${fmtDate(driver.licenceExpiry)}` })
    if (expiryState(driver.medicalExpiry, 0, startMs).state === 'expired') out.push({ level: 'warn', text: `${driver.name}'s medical certificate expired on ${fmtDate(driver.medicalExpiry)}` })
    if (expiryState(driver.defensiveDrivingExpiry, 0, startMs).state === 'expired') out.push({ level: 'warn', text: `${driver.name}'s defensive-driving certificate expired on ${fmtDate(driver.defensiveDrivingExpiry)}` })
    for (const t of conflictsFor('driverId', driver.id).slice(0, 2)) {
      if (dispatch && isActive(t.status)) out.push({ level: 'block', text: `${driver.name} is still driving ${t.ref} (${TRIP_STATUS[t.status].label.toLowerCase()})` })
      else out.push({ level: 'warn', text: `${driver.name} overlaps ${t.ref} (${TRIP_STATUS[t.status].label.toLowerCase()}, ${fmtDateTime(windowOf(t)[0])})` })
    }
  }

  const rank: Record<CheckLevel, number> = { block: 0, warn: 1, ok: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}

export const blockersOf = (c: Check[]) => c.filter((x) => x.level === 'block')
export const warningsOf = (c: Check[]) => c.filter((x) => x.level === 'warn')

/* ----------------------------------------------------------------------------------------------- *
 * Mutations
 * ----------------------------------------------------------------------------------------------- */
const db = () => useDb.getState()
export const getTrip = (id: ID) => db().trips.find((t) => t.id === id)
const iso = (ms = Date.now()) => new Date(ms).toISOString()
const patchTrip = (id: ID, patch: Partial<Trip>, summary: string, action: 'update' | 'status' | 'assign' = 'update') => db().update('trips', id, patch, { summary, action })

const SHIP_ORDER: ShipmentStatus[] = ['registered', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered']

/** Keep the linked shipment in step with its trip (silent: the trip audit entry already describes the action). */
function advanceShipment(trip: Trip, to: ShipmentStatus, extra: Partial<Shipment> = {}) {
  const sh = db().shipments.find((x) => x.id === trip.shipmentId || x.tripId === trip.id)
  if (!sh || sh.status === 'delivered') return
  const at = iso()
  const idx = SHIP_ORDER.indexOf(to)
  const milestones = sh.milestones.map((m) => {
    const i = SHIP_ORDER.indexOf(m.key as ShipmentStatus)
    return i >= 0 && i <= idx && !m.at ? { ...m, at } : m
  })
  const advance = idx > SHIP_ORDER.indexOf(sh.status) || sh.status === 'exception'
  db().update('shipments', sh.id, { status: advance ? to : sh.status, milestones, ...extra }, { silent: true })
}

export interface TripDraft {
  customerId: ID | null
  routeId: string
  routeDir: 1 | -1
  origin: Place
  destination: Place
  cargoType: Trip['cargoType']
  cargoDescription: string
  cargoWeightKg: number
  scheduledStart: string
  plannedDistanceKm: number
  plannedDurationMin: number
  priority: Trip['priority']
  vehicleId: ID | null
  driverId: ID | null
  branchId: ID
  revenueUsd: number
  notes?: string
}

export function createTrip(d: TripDraft): Trip {
  const start = new Date(d.scheduledStart).getTime()
  const ref = nextTripRef()
  return db().insert(
    'trips',
    {
      ref,
      status: deriveStatus(d.vehicleId, d.driverId, d.scheduledStart),
      vehicleId: d.vehicleId,
      driverId: d.driverId,
      customerId: d.customerId,
      shipmentId: null,
      branchId: d.branchId,
      routeId: d.routeId,
      routeDir: d.routeDir,
      origin: d.origin,
      destination: d.destination,
      cargoType: d.cargoType,
      cargoDescription: d.cargoDescription,
      cargoWeightKg: d.cargoWeightKg,
      scheduledStart: iso(start),
      actualStart: null,
      plannedEnd: iso(start + d.plannedDurationMin * 6e4),
      actualEnd: null,
      plannedDistanceKm: d.plannedDistanceKm,
      actualDistanceKm: null,
      plannedDurationMin: d.plannedDurationMin,
      actualDurationMin: null,
      delayMinutes: 0,
      expensesUsd: 0,
      revenueUsd: d.revenueUsd,
      pod: null,
      priority: d.priority,
      notes: d.notes || undefined,
      createdAt: iso(),
    },
    { summary: `Created trip ${ref} (${d.origin.city} → ${d.destination.city})` },
  )
}

/** Edit a trip. `restricted` trips (in transit / completed) only accept cargo, priority, notes and revenue changes. */
export function updateTrip(tripId: ID, d: TripDraft, restricted: boolean) {
  const trip = getTrip(tripId)
  if (!trip) return
  if (restricted) {
    patchTrip(tripId, { cargoType: d.cargoType, cargoDescription: d.cargoDescription, cargoWeightKg: d.cargoWeightKg, priority: d.priority, revenueUsd: d.revenueUsd, notes: d.notes || undefined }, `Updated trip ${trip.ref}`)
    return
  }
  const start = new Date(d.scheduledStart).getTime()
  const status = deriveStatus(d.vehicleId, d.driverId, d.scheduledStart)
  patchTrip(
    tripId,
    {
      customerId: d.customerId, routeId: d.routeId, routeDir: d.routeDir, origin: d.origin, destination: d.destination, cargoType: d.cargoType, cargoDescription: d.cargoDescription,
      cargoWeightKg: d.cargoWeightKg, scheduledStart: iso(start), plannedEnd: iso(start + d.plannedDurationMin * 6e4), plannedDistanceKm: d.plannedDistanceKm, plannedDurationMin: d.plannedDurationMin,
      priority: d.priority, vehicleId: d.vehicleId, driverId: d.driverId, branchId: d.branchId, revenueUsd: d.revenueUsd, notes: d.notes || undefined, status,
    },
    `Updated trip ${trip.ref}`,
  )
  const sh = db().shipments.find((x) => x.id === trip.shipmentId || x.tripId === trip.id)
  if (sh && sh.status !== 'delivered') db().update('shipments', sh.id, { vehicleId: d.vehicleId, driverId: d.driverId }, { silent: true })
}

/** Assign vehicle + driver. Awaiting trips move on to Scheduled / Ready depending on `then` or the start time. */
export function assignTrip(tripId: ID, vehicleId: ID, driverId: ID, then?: 'ready' | 'scheduled') {
  const trip = getTrip(tripId)
  const vehicle = db().vehicles.find((v) => v.id === vehicleId)
  const driver = db().drivers.find((d) => d.id === driverId)
  if (!trip || !vehicle || !driver) return
  let status = trip.status
  if (trip.status === 'awaiting_assignment') status = then ?? deriveStatus(vehicleId, driverId, trip.scheduledStart)
  else if (trip.status === 'scheduled' && then === 'ready') status = 'ready'
  else if (trip.status === 'ready' && then === 'scheduled') status = 'scheduled'
  patchTrip(tripId, { vehicleId, driverId, status }, `Assigned ${trip.ref} to ${vehicle.reg} / ${driver.name}`, 'assign')
  advanceShipment(trip, 'allocated', { vehicleId, driverId, tripId: trip.id })
}

export function unassignTrip(tripId: ID) {
  const trip = getTrip(tripId)
  if (!trip) return
  patchTrip(tripId, { status: 'awaiting_assignment', vehicleId: null, driverId: null }, `Returned ${trip.ref} to the assignment queue`, 'assign')
  const sh = db().shipments.find((x) => x.id === trip.shipmentId || x.tripId === trip.id)
  if (sh && (sh.status === 'allocated' || sh.status === 'registered')) db().update('shipments', sh.id, { vehicleId: null, driverId: null }, { silent: true })
}

export function setTripStage(tripId: ID, status: 'scheduled' | 'ready') {
  const trip = getTrip(tripId)
  if (!trip) return
  patchTrip(tripId, { status }, `${status === 'ready' ? 'Marked' : 'Moved'} ${trip.ref} ${status === 'ready' ? 'ready for dispatch' : 'back to scheduled'}`, 'status')
}

/** Dispatch: the simulator sees `in_transit` and starts driving the vehicle along the route. */
export function dispatchTrip(tripId: ID) {
  const trip = getTrip(tripId)
  if (!trip) return
  const now = Date.now()
  const reg = db().vehicles.find((v) => v.id === trip.vehicleId)?.reg ?? 'vehicle'
  patchTrip(tripId, { status: 'in_transit', actualStart: iso(now), plannedEnd: iso(now + trip.plannedDurationMin * 6e4), delayMinutes: 0, delayReason: undefined }, `Dispatched ${trip.ref} with ${reg}`, 'status')
  advanceShipment(trip, 'in_transit')
}

export function delayTrip(tripId: ID, minutes: number, reason: string) {
  const trip = getTrip(tripId)
  if (!trip) return
  patchTrip(tripId, { status: 'delayed', delayMinutes: minutes, delayReason: reason }, `Marked ${trip.ref} delayed by ${fmtDuration(minutes)} – ${reason}`, 'status')
}

export function clearDelay(tripId: ID) {
  const trip = getTrip(tripId)
  if (!trip) return
  patchTrip(tripId, { status: 'in_transit', delayMinutes: 0, delayReason: undefined }, `Cleared the delay on ${trip.ref}`, 'status')
}

export interface PodInput {
  receivedBy: string
  signedAt: string
  conditionOk: boolean
  photoCount: number
  notes?: string
  actualDistanceKm: number
  delayReason?: string
}

/** Complete a delivery with proof of delivery. On an already-completed trip this only amends the POD. */
export function completeTrip(tripId: ID, input: PodInput) {
  const trip = getTrip(tripId)
  if (!trip) return
  const pod = { receivedBy: input.receivedBy.trim(), signedAt: input.signedAt, notes: input.notes?.trim() || undefined, photoCount: input.photoCount, conditionOk: input.conditionOk }
  if (trip.status === 'completed') {
    patchTrip(tripId, { pod }, `Updated proof of delivery for ${trip.ref}`)
    const sh = db().shipments.find((x) => x.id === trip.shipmentId || x.tripId === trip.id)
    if (sh) db().update('shipments', sh.id, { pod }, { silent: true })
    return
  }
  const startMs = new Date(trip.actualStart ?? trip.scheduledStart).getTime()
  const endMs = new Date(input.signedAt).getTime()
  const actualDurationMin = Math.max(1, Math.round((endMs - startMs) / 6e4))
  const delayMinutes = Math.max(0, actualDurationMin - trip.plannedDurationMin)
  patchTrip(
    tripId,
    {
      status: 'completed',
      actualEnd: input.signedAt,
      actualStart: trip.actualStart ?? iso(startMs),
      actualDurationMin,
      actualDistanceKm: input.actualDistanceKm,
      delayMinutes,
      delayReason: delayMinutes > 0 ? (input.delayReason ?? trip.delayReason) : undefined,
      pod,
    },
    `Completed ${trip.ref} – received by ${pod.receivedBy}`,
    'status',
  )
  advanceShipment(trip, 'delivered', { deliveredAt: input.signedAt, pod })
}

export function cancelTrip(tripId: ID, reason: string) {
  const trip = getTrip(tripId)
  if (!trip || isTerminal(trip.status)) return
  patchTrip(tripId, { status: 'cancelled', delayReason: reason, delayMinutes: 0 }, `Cancelled ${trip.ref} – ${reason}`, 'status')
  const sh = db().shipments.find((x) => x.id === trip.shipmentId || x.tripId === trip.id)
  if (sh && sh.status !== 'delivered') db().update('shipments', sh.id, { status: 'exception', exception: { type: 'Trip cancelled', description: reason, raisedAt: iso(), resolved: false } }, { silent: true })
}

export function reinstateTrip(tripId: ID, to: TripStatus) {
  const trip = getTrip(tripId)
  if (!trip || trip.status !== 'cancelled') return
  patchTrip(tripId, { status: to, delayReason: undefined, delayMinutes: 0 }, `Reinstated ${trip.ref} as ${TRIP_STATUS[to].label.toLowerCase()}`, 'status')
  const sh = db().shipments.find((x) => x.id === trip.shipmentId || x.tripId === trip.id)
  if (sh && sh.status === 'exception' && sh.exception?.type === 'Trip cancelled') db().update('shipments', sh.id, { status: trip.vehicleId ? 'allocated' : 'registered', exception: null }, { silent: true })
}

/** Delete draft trips only (awaiting / scheduled / ready). Returns the number deleted. */
export function deleteTrips(ids: ID[]): number {
  const trips = db().trips.filter((t) => ids.includes(t.id) && isDraft(t.status))
  if (!trips.length) return 0
  for (const t of trips) {
    const sh = db().shipments.find((x) => x.id === t.shipmentId || x.tripId === t.id)
    if (sh) db().update('shipments', sh.id, { tripId: null }, { silent: true })
  }
  if (trips.length === 1) db().remove('trips', trips[0]!.id, { summary: `Deleted trip ${trips[0]!.ref}` })
  else db().removeMany('trips', trips.map((t) => t.id), { summary: `Deleted ${trips.length} draft trips` })
  return trips.length
}
