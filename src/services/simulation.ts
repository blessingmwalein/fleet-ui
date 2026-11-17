import type { LiveState, Telemetry, Trip, Vehicle, VehicleCategory } from '@/types'
import { ROUTE_BY_ID, pointAt, routeEndpoints, type Route } from '@/data/routes'
import { describeLocation } from '@/data/places'
import { SIM_STORAGE_KEY } from '@/data/bootstrap'
import { bearingDeg, haversineM } from '@/lib/geo'
import { createRng, hashString } from '@/lib/rng'
import { clamp } from '@/lib/utils'
import { FUEL_STATIONS } from '@/data/seed/support'
import { db, useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { eventBus, type LiveEvent } from './events'

/**
 * GPS SIMULATION ENGINE — demo data only.
 *
 * Every vehicle follows a road-following polyline (real OSRM geometry, see data/routes.generated.ts). Each tick
 * (default every 2 s) the engine produces a new "GPS fix" per vehicle and writes `Telemetry` to the live store.
 * The map interpolates between the previous and current fix (see `fixBuffer`) so markers glide instead of jumping.
 *
 * To connect real telematics, publish `Telemetry` into `useLive.getState().setTelemetry()` and the same fixes
 * into `fixBuffer`, then stop this simulator (see services/realtime.ts).
 */

export interface Fix {
  lat: number
  lng: number
  heading: number
  speed: number
  /** wall-clock ms when this fix was produced */
  at: number
}

/** Previous/current fix per vehicle — read by the map's animation loop (non-reactive, 60fps friendly). */
export const fixBuffer = new Map<string, { prev: Fix; curr: Fix }>()

type Mode = 'route' | 'approach' | 'parked' | 'dwell'

interface SimVehicle {
  id: string
  mode: Mode
  route: Route | null
  dir: 1 | -1
  progressM: number
  lat: number
  lng: number
  heading: number
  speed: number
  engineOn: boolean
  gpsOnline: boolean
  state: LiveState
  fuelPct: number
  odo: number
  tripId: string | null
  dwellUntil: number
  stopUntil: number
  offlineUntil: number // 0 = online, Infinity = permanently offline
  lastFixTs: number
  approachTarget: { lat: number; lng: number } | null
  pendingTripId: string | null
  burstTicks: number
  speedingAt: number
  lowFuelFired: boolean
  inside: Set<string>
  traffic: number
  aggression: number
}

const HIGHWAY_CRUISE: Record<VehicleCategory, number> = { heavy_truck: 74, tanker: 72, refrigerated: 80, bus: 88, light_truck: 88, delivery_van: 92, pickup: 96, service: 90, motorcycle: 92 }
const HIGHWAY_LIMIT: Record<VehicleCategory, number> = { heavy_truck: 80, tanker: 80, refrigerated: 90, bus: 100, light_truck: 100, delivery_van: 100, pickup: 100, service: 100, motorcycle: 100 }
const L_PER_100: Record<VehicleCategory, number> = { heavy_truck: 38, tanker: 40, refrigerated: 24, bus: 30, light_truck: 18, delivery_van: 12, pickup: 11, service: 11, motorcycle: 3.5 }

const sims = new Map<string, SimVehicle>()
let timer: ReturnType<typeof setInterval> | undefined
let lastTickAt = 0
let tickN = 0
let currentInterval = 0
let rng = createRng(Date.now() & 0xffff)

const emit = (e: LiveEvent) => {
  if (useSettings.getState().simulation.events) eventBus.publish(e)
}

function loadSnapshot(): Record<string, { tripId: string | null; progressM: number; fuelPct: number; odo: number }> {
  try {
    const raw = localStorage.getItem(SIM_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { seededAt: number; v: Record<string, { tripId: string | null; progressM: number; fuelPct: number; odo: number }> }
    return parsed.seededAt === useDb.getState().seededAt ? parsed.v : {}
  } catch {
    return {}
  }
}

function saveSnapshot() {
  try {
    const v: Record<string, unknown> = {}
    for (const s of sims.values()) v[s.id] = { tripId: s.tripId, progressM: Math.round(s.progressM), fuelPct: Math.round(s.fuelPct * 10) / 10, odo: Math.round(s.odo) }
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify({ seededAt: useDb.getState().seededAt, v }))
  } catch {
    /* ignore quota */
  }
}

const activeTripOf = (trips: Trip[], vehicleId: string) => trips.find((t) => t.vehicleId === vehicleId && (t.status === 'in_transit' || t.status === 'delayed'))

function routePos(s: SimVehicle) {
  const r = s.route!
  return pointAt(r, s.dir === 1 ? s.progressM : r.lengthM - s.progressM, s.dir)
}

function aggressionOf(driverId: string | null): number {
  const d = driverId ? db().drivers.find((x) => x.id === driverId) : null
  const score = d?.safetyScore ?? 80
  return clamp((85 - score) / 35, 0, 1)
}

function initVehicle(v: Vehicle, trips: Trip[], snapshot: ReturnType<typeof loadSnapshot>, now: number): SimVehicle {
  const trip = activeTripOf(trips, v.id)
  const h = hashString(v.id)
  const base: SimVehicle = {
    id: v.id, mode: 'parked', route: null, dir: 1, progressM: 0, lat: v.homeLat, lng: v.homeLng, heading: (h % 360), speed: 0, engineOn: false, gpsOnline: true,
    state: 'stopped', fuelPct: v.fuelPct, odo: v.odometerKm, tripId: null, dwellUntil: 0, stopUntil: 0, offlineUntil: 0, lastFixTs: now, approachTarget: null, pendingTripId: null,
    burstTicks: 0, speedingAt: 0, lowFuelFired: false, inside: new Set(), traffic: 1, aggression: aggressionOf(v.driverId),
  }
  if (v.status === 'maintenance') {
    const wks = db().branches.find((b) => b.id === 'br-wks')
    if (wks) {
      base.lat = wks.lat + ((h % 7) - 3) * 0.00035
      base.lng = wks.lng + (((h >> 3) % 5) - 2) * 0.00035
    }
    base.state = 'maintenance'
    return base
  }
  if (v.status === 'out_of_service') {
    base.gpsOnline = false
    base.state = 'offline'
    base.offlineUntil = Infinity
    return base
  }
  if (trip && ROUTE_BY_ID[trip.routeId]) {
    const route = ROUTE_BY_ID[trip.routeId]!
    const snap = snapshot[v.id]
    const elapsed = (now - new Date(trip.actualStart ?? trip.scheduledStart).getTime()) / (trip.plannedDurationMin * 6e4)
    base.mode = 'route'
    base.route = route
    base.dir = trip.routeDir
    base.tripId = trip.id
    base.progressM = snap && snap.tripId === trip.id ? snap.progressM : clamp(elapsed, 0.02, 0.97) * route.lengthM
    if (snap && snap.tripId === trip.id) {
      base.fuelPct = snap.fuelPct
      base.odo = snap.odo
    }
    const p = routePos(base)
    base.lat = p.lat
    base.lng = p.lng
    base.heading = p.heading
    base.engineOn = true
    base.state = 'moving'
    base.speed = 40
    if (h % 10 === 3) {
      // GPS device offline mid-route — frozen at last known position
      base.gpsOnline = false
      base.state = 'offline'
      base.offlineUntil = Infinity
      base.speed = 0
      base.engineOn = false
    }
    return base
  }
  // parked at depot
  base.engineOn = h % 3 === 0
  base.state = base.engineOn ? 'idle' : 'stopped'
  if (h % 10 === 3) {
    base.gpsOnline = false
    base.state = 'offline'
    base.offlineUntil = Infinity
    base.engineOn = false
  }
  return base
}

function limitFor(s: SimVehicle, cat: VehicleCategory) {
  if (s.mode === 'approach' || s.mode === 'parked') return 40
  if (!s.route) return 60
  return s.route.kind === 'city' ? 60 : HIGHWAY_LIMIT[cat]
}

function nextTripFor(vehicleId: string, trips: Trip[]) {
  return trips
    .filter((t) => t.vehicleId === vehicleId && (t.status === 'ready' || t.status === 'scheduled') && ROUTE_BY_ID[t.routeId])
    .sort((a, b) => (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || a.scheduledStart.localeCompare(b.scheduledStart))[0]
}

function nextRef() {
  let max = 10240
  for (const t of db().trips) {
    const m = /(\d+)$/.exec(t.ref)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `TRP-${new Date().getFullYear()}-${String(max + 1).padStart(5, '0')}`
}

/** Begin (or approach the start of) a trip. */
function beginTrip(s: SimVehicle, trip: Trip, now: number) {
  const route = ROUTE_BY_ID[trip.routeId]!
  const start = routeEndpoints(route, trip.routeDir).from
  const dist = haversineM({ lat: s.lat, lng: s.lng }, start)
  db().update('trips', trip.id, { status: 'in_transit', actualStart: new Date(now).toISOString() }, { silent: true })
  s.tripId = trip.id
  s.route = route
  s.dir = trip.routeDir
  s.engineOn = true
  s.dwellUntil = 0
  const v = db().vehicles.find((x) => x.id === s.id)!
  emit({ type: 'trip_started', severity: 'info', title: `${v.reg} departed`, message: `${trip.ref}: ${trip.origin.name} → ${trip.destination.name}`, entity: { type: 'trip', id: trip.id } })
  if (dist > 250) {
    s.mode = 'approach'
    s.approachTarget = start
    s.pendingTripId = trip.id
    s.progressM = 0
  } else {
    s.mode = 'route'
    s.progressM = 0
    s.approachTarget = null
  }
}

function completeTrip(s: SimVehicle, now: number) {
  const trips = db().trips
  const trip = trips.find((t) => t.id === s.tripId)
  if (!trip) return
  const v = db().vehicles.find((x) => x.id === s.id)!
  const planned = trip.plannedDurationMin
  const late = trip.status === 'delayed' ? trip.delayMinutes : Math.max(0, Math.round(planned * rng.float(-0.06, 0.1)))
  const actualMin = planned + late
  const cust = trip.customerId ? db().customers.find((c) => c.id === trip.customerId) : null
  const nowIso = new Date(now).toISOString()
  db().update(
    'trips',
    trip.id,
    {
      status: 'completed',
      actualEnd: nowIso,
      actualDurationMin: actualMin,
      actualDistanceKm: Math.round((s.route!.lengthM / 1000) * rng.float(0.995, 1.04) * 10) / 10,
      delayMinutes: Math.max(0, late),
      pod: v.category === 'service' ? null : { receivedBy: cust?.contactName ?? 'Receiving clerk', signedAt: nowIso, photoCount: rng.int(1, 3), conditionOk: true },
    },
    { silent: true },
  )
  if (trip.shipmentId) {
    const sh = db().shipments.find((x) => x.id === trip.shipmentId)
    if (sh)
      db().update(
        'shipments',
        sh.id,
        {
          status: 'delivered',
          deliveredAt: nowIso,
          pod: { receivedBy: cust?.contactName ?? 'Receiving clerk', signedAt: nowIso, photoCount: 2, conditionOk: true },
          milestones: sh.milestones.map((m) => (m.at ? m : m.key === 'exception' ? m : { ...m, at: nowIso })),
        },
        { silent: true },
      )
  }
  emit({
    type: 'delivery_completed',
    severity: 'success',
    title: `Delivery completed – ${trip.ref}`,
    message: `${v.reg} arrived at ${trip.destination.name}.`,
    entity: { type: 'trip', id: trip.id },
  })
  // refuel when low
  if (s.fuelPct < 32 && v.category !== 'service') refuel(s, v, trip, now)
  s.tripId = null
}

function refuel(s: SimVehicle, v: Vehicle, trip: Trip, now: number) {
  const litres = Math.round(((92 - s.fuelPct) / 100) * v.tankCapacityL * 10) / 10
  const station = FUEL_STATIONS.find((st) => st.city === trip.destination.city && st.status === 'approved') ?? FUEL_STATIONS[0]!
  const card = db().fuelCards.find((c) => c.vehicleId === v.id)
  db().insert(
    'fuelTransactions',
    {
      ref: `FT-${30000 + db().fuelTransactions.length}`,
      vehicleId: v.id,
      driverId: v.driverId,
      stationId: station.id,
      cardId: card?.id ?? null,
      branchId: v.branchId,
      tripId: trip.id,
      date: new Date(now).toISOString(),
      litres,
      pricePerLitreUsd: station.dieselPriceUsd,
      totalUsd: Math.round(litres * station.dieselPriceUsd * 100) / 100,
      odometerKm: Math.round(s.odo),
      fuelType: v.fuelType,
      fullTank: true,
      flag: null,
      reconciled: false,
      receiptNo: `R${rng.int(100000, 999999)}`,
    },
    { silent: true },
  )
  s.fuelPct = 92
  s.lowFuelFired = false
}

function startNextOrReturn(s: SimVehicle, now: number) {
  const v = db().vehicles.find((x) => x.id === s.id)
  if (!v || v.status !== 'active') {
    s.mode = 'parked'
    s.state = 'stopped'
    return
  }
  const trips = db().trips
  const queued = nextTripFor(s.id, trips)
  if (queued) {
    beginTrip(s, queued, now)
    return
  }
  // auto-create a backhaul / return trip so the fleet keeps circulating
  const prev = [...trips].reverse().find((t) => t.vehicleId === s.id && t.status === 'completed')
  if (!prev || !s.route || v.category === 'service' && rng.chance(0.4)) {
    s.mode = 'parked'
    s.state = 'idle'
    s.engineOn = true
    return
  }
  const route = s.route
  const dir = (s.dir === 1 ? -1 : 1) as 1 | -1
  const ep = routeEndpoints(route, dir)
  const planned = prev.plannedDurationMin
  const created = db().insert(
    'trips',
    {
      ref: nextRef(),
      status: 'ready',
      vehicleId: v.id,
      driverId: v.driverId,
      customerId: prev.customerId,
      shipmentId: null,
      branchId: v.branchId,
      routeId: route.id,
      routeDir: dir,
      origin: { name: prev.destination.name, city: prev.destination.city, lat: ep.from.lat, lng: ep.from.lng },
      destination: { name: prev.origin.name, city: prev.origin.city, lat: ep.to.lat, lng: ep.to.lng },
      cargoType: 'general',
      cargoDescription: 'Return load / backhaul',
      cargoWeightKg: Math.round(v.loadCapacityKg * rng.float(0.2, 0.6)),
      scheduledStart: new Date(now).toISOString(),
      actualStart: null,
      plannedEnd: new Date(now + planned * 6e4).toISOString(),
      actualEnd: null,
      plannedDistanceKm: prev.plannedDistanceKm,
      actualDistanceKm: null,
      plannedDurationMin: planned,
      actualDurationMin: null,
      delayMinutes: 0,
      expensesUsd: 0,
      revenueUsd: v.category === 'service' ? 0 : Math.round(prev.revenueUsd * 0.35),
      pod: null,
      priority: 'normal',
      createdAt: new Date(now).toISOString(),
    },
    { silent: true },
  )
  beginTrip(s, created, now)
}

function applyAdminState(s: SimVehicle, v: Vehicle) {
  if (v.status === 'maintenance' && s.state !== 'maintenance') {
    s.state = 'maintenance'
    s.speed = 0
    s.engineOn = false
    s.mode = 'parked'
    s.stopUntil = 0
  } else if (v.status === 'out_of_service' && s.offlineUntil !== Infinity) {
    s.state = 'offline'
    s.gpsOnline = false
    s.offlineUntil = Infinity
    s.speed = 0
    s.engineOn = false
    s.mode = 'parked'
  } else if (v.status === 'active' && (s.state === 'maintenance' || (s.state === 'offline' && s.offlineUntil === Infinity && !s.tripId && s.mode === 'parked' && hashString(v.id) % 10 !== 3))) {
    s.state = 'idle'
    s.gpsOnline = true
    s.offlineUntil = 0
    s.engineOn = true
  }
}

function stepVehicle(s: SimVehicle, v: Vehicle, dt: number, scale: number, now: number) {
  const trips = db().trips
  const settings = useSettings.getState()

  // ---- recover from transient GPS loss ----
  if (s.offlineUntil !== 0 && s.offlineUntil !== Infinity && now >= s.offlineUntil) {
    s.offlineUntil = 0
    s.gpsOnline = true
    s.state = s.speed > 3 ? 'moving' : 'idle'
    emit({ type: 'vehicle_online', severity: 'success', title: `${v.reg} back online`, message: 'GPS device resumed reporting.', entity: { type: 'vehicle', id: v.id } })
  }
  if (!s.gpsOnline || s.state === 'maintenance') {
    s.speed = 0
    return
  }

  // ---- sync trip state edited elsewhere (dispatch board, drawers) ----
  if (s.tripId && (s.mode === 'route' || s.mode === 'approach')) {
    const t = trips.find((x) => x.id === s.tripId)
    if (!t || (t.status !== 'in_transit' && t.status !== 'delayed')) {
      s.mode = 'parked'
      s.tripId = null
      s.speed = 0
      s.state = 'stopped'
      s.engineOn = false
    }
  }
  if (s.mode === 'parked') {
    const t = activeTripOf(trips, s.id)
    if (t && ROUTE_BY_ID[t.routeId] && v.status === 'active') {
      // trip dispatched from the board — drive to the start of its route
      const route = ROUTE_BY_ID[t.routeId]!
      const start = routeEndpoints(route, t.routeDir).from
      s.tripId = t.id
      s.route = route
      s.dir = t.routeDir
      s.engineOn = true
      if (haversineM({ lat: s.lat, lng: s.lng }, start) > 250) {
        s.mode = 'approach'
        s.approachTarget = start
        s.pendingTripId = t.id
      } else {
        s.mode = 'route'
        s.progressM = 0
      }
    } else {
      s.speed = 0
      if (s.state === 'moving') s.state = s.engineOn ? 'idle' : 'stopped'
      return
    }
  }

  const trip = s.tripId ? trips.find((x) => x.id === s.tripId) : undefined
  const delayed = trip?.status === 'delayed'

  if (s.mode === 'dwell') {
    s.speed = 0
    s.state = 'stopped'
    s.engineOn = false
    if (now >= s.dwellUntil) startNextOrReturn(s, now)
    return
  }

  if (s.mode === 'approach' && s.approachTarget) {
    const target = s.approachTarget
    const remaining = haversineM({ lat: s.lat, lng: s.lng }, target)
    s.speed += (42 - s.speed) * 0.4
    const move = Math.min(remaining, (s.speed / 3.6) * dt * scale)
    const brg = bearingDeg({ lat: s.lat, lng: s.lng }, target)
    const f = remaining > 0 ? move / remaining : 1
    s.lat += (target.lat - s.lat) * f
    s.lng += (target.lng - s.lng) * f
    s.heading = brg
    s.state = 'moving'
    s.odo += move / 1000
    if (remaining - move < 60) {
      s.mode = 'route'
      s.progressM = 0
      s.approachTarget = null
      s.pendingTripId = null
    }
    return
  }

  if (s.mode !== 'route' || !s.route) return
  const route = s.route
  const remaining = route.lengthM - s.progressM

  // ---- speed model ----
  const cruise = (route.kind === 'highway' ? HIGHWAY_CRUISE[v.category] : 38 + (hashString(v.id) % 9)) * s.traffic * (delayed ? 0.55 : 1)
  let target = cruise
  if (remaining < 2500) target = Math.min(target, 28)
  if (remaining < 400) target = Math.min(target, 12)
  if (s.progressM < 600) target = Math.min(target, 35)
  if (s.burstTicks > 0) {
    target = limitFor(s, v.category) + 10 + s.aggression * 18
    s.burstTicks--
  } else if (s.aggression > 0.35 && route.kind === 'highway' && rng.chance(0.012 * s.aggression)) {
    s.burstTicks = rng.int(5, 12)
  }
  if (now < s.stopUntil) target = 0
  s.traffic = clamp(s.traffic + rng.float(-0.04, 0.04), 0.78, 1.08)
  s.speed = Math.max(0, s.speed + (target - s.speed) * 0.38 + rng.float(-1.5, 1.5))
  if (target === 0 && s.speed < 3) s.speed = 0

  // random traffic-light / junction stops in the city
  if (route.kind === 'city' && s.speed > 20 && rng.chance(0.03)) s.stopUntil = now + rng.int(3, 9) * 1000

  // ---- movement ----
  const distM = (s.speed / 3.6) * dt * scale
  s.progressM = Math.min(route.lengthM, s.progressM + distM)
  s.odo += distM / 1000
  s.fuelPct = Math.max(1.5, s.fuelPct - ((distM / 1000) * L_PER_100[v.category]) / 100 / v.tankCapacityL * 100)
  const p = routePos(s)
  s.lat = p.lat
  s.lng = p.lng
  s.heading = p.heading
  s.engineOn = true
  s.state = s.speed > 3 ? 'moving' : 'idle'

  // ---- arrival ----
  if (s.progressM >= route.lengthM - 1) {
    s.speed = 0
    s.state = 'stopped'
    s.mode = 'dwell'
    s.dwellUntil = now + rng.int(9, 18) * 1000
    completeTrip(s, now)
    return
  }

  // ---- random events ----
  if (trip && trip.status === 'in_transit' && rng.chance(0.0006 * (settings.simulation.events ? 1 : 0))) {
    const reasons = ['Heavy traffic', 'Road works – single lane', 'Roadside inspection', 'Mechanical issue – reduced speed']
    const delayMin = rng.int(20, 90)
    db().update('trips', trip.id, { status: 'delayed', delayMinutes: delayMin, delayReason: rng.pick(reasons) }, { silent: true })
    emit({ type: 'trip_delayed', severity: 'warning', title: `Trip ${trip.ref} delayed`, message: `${v.reg} is ~${delayMin} min behind schedule.`, entity: { type: 'trip', id: trip.id } })
  }
  if (rng.chance(0.0005)) {
    s.offlineUntil = now + rng.int(25, 60) * 1000
    s.gpsOnline = false
    s.state = 'offline'
    emit({ type: 'vehicle_offline', severity: 'critical', title: `${v.reg} went offline`, message: 'GPS device stopped reporting. Last known position retained.', entity: { type: 'vehicle', id: v.id } })
  }
  if (s.speed > 40 && rng.chance(0.0016 * (0.4 + s.aggression))) {
    db().insert(
      'safetyEvents',
      {
        type: 'harsh_braking', severity: 'medium', vehicleId: v.id, driverId: v.driverId, branchId: v.branchId, tripId: s.tripId, timestamp: new Date(now).toISOString(),
        location: describeLocation(s), lat: s.lat, lng: s.lng, speedKph: Math.round(s.speed), value: Math.round(rng.float(0.42, 0.68) * 100) / 100, reviewed: false,
      },
      { silent: true },
    )
    emit({ type: 'harsh_event', severity: 'warning', title: `Harsh braking – ${v.reg}`, message: `${describeLocation(s)} at ${Math.round(s.speed)} km/h.`, entity: { type: 'vehicle', id: v.id } })
  }
}

function checkAlerts(s: SimVehicle, v: Vehicle, now: number) {
  const settings = useSettings.getState()
  const limit = limitFor(s, v.category)
  // speeding
  if (s.speed > limit + 5 && now - s.speedingAt > 90_000 && s.mode === 'route') {
    s.speedingAt = now
    const over = Math.round(s.speed - limit)
    emit({ type: 'speeding', severity: over > 20 ? 'critical' : 'warning', title: `${v.reg} speeding`, message: `${Math.round(s.speed)} km/h in a ${limit} km/h zone near ${describeLocation(s)}.`, entity: { type: 'vehicle', id: v.id } })
    db().insert(
      'safetyEvents',
      {
        type: 'speeding', severity: over > 20 ? 'high' : 'medium', vehicleId: v.id, driverId: v.driverId, branchId: v.branchId, tripId: s.tripId, timestamp: new Date(now).toISOString(),
        location: describeLocation(s), lat: s.lat, lng: s.lng, speedKph: Math.round(s.speed), limitKph: limit, reviewed: false,
      },
      { silent: true },
    )
  }
  // low fuel
  if (!s.lowFuelFired && s.fuelPct < settings.thresholds.lowFuelPct && s.mode === 'route') {
    s.lowFuelFired = true
    emit({ type: 'low_fuel', severity: 'warning', title: `Low fuel: ${v.reg}`, message: `Fuel at ${Math.round(s.fuelPct)}%. ${describeLocation(s)}.`, entity: { type: 'vehicle', id: v.id } })
  } else if (s.lowFuelFired && s.fuelPct > settings.thresholds.lowFuelPct + 10) s.lowFuelFired = false
  // geofences
  const fences = db().geofences
  const now_inside = new Set<string>()
  for (const g of fences) if (haversineM({ lat: s.lat, lng: s.lng }, g) <= g.radiusM) now_inside.add(g.id)
  for (const id of now_inside) {
    if (!s.inside.has(id)) {
      const g = fences.find((x) => x.id === id)!
      if (g.alertOnEnter && g.kind !== 'city' && !(g.kind === 'restricted' && ['pickup', 'delivery_van', 'service', 'light_truck'].includes(v.category)))
        emit({ type: 'geofence_enter', severity: g.kind === 'restricted' ? 'warning' : 'info', title: `${v.reg} entered ${g.name}`, message: g.kind === 'restricted' ? 'Restricted zone entry — heavy vehicle.' : 'Arrived at monitored location.', entity: { type: 'vehicle', id: v.id } })
    }
  }
  for (const id of s.inside) {
    if (!now_inside.has(id)) {
      const g = fences.find((x) => x.id === id)
      if (g?.alertOnExit && g.kind !== 'city') emit({ type: 'geofence_exit', severity: 'info', title: `${v.reg} left ${g.name}`, message: 'Departed monitored location.', entity: { type: 'vehicle', id: v.id } })
    }
  }
  s.inside = now_inside
}

function toTelemetry(s: SimVehicle, v: Vehicle, trips: Trip[], now: number, scale: number): Telemetry {
  const trip = s.tripId ? trips.find((t) => t.id === s.tripId) : undefined
  const len = s.route?.lengthM ?? 0
  const remainingM = s.mode === 'route' ? Math.max(0, len - s.progressM) : s.mode === 'approach' && s.approachTarget ? haversineM({ lat: s.lat, lng: s.lng }, s.approachTarget) : 0
  const effKph = Math.max(s.speed, 32)
  const active = (s.mode === 'route' || s.mode === 'approach') && !!trip && s.gpsOnline
  const etaTs = active ? now + (((remainingM + (s.mode === 'approach' && trip ? trip.plannedDistanceKm * 1000 : 0)) / (effKph / 3.6)) / scale) * 1000 : null
  const limit = limitFor(s, v.category)
  return {
    vehicleId: s.id,
    lat: s.lat,
    lng: s.lng,
    heading: Math.round(s.heading),
    speedKph: Math.round(s.speed),
    state: s.state,
    engineOn: s.engineOn,
    gpsOnline: s.gpsOnline,
    fuelPct: Math.round(s.fuelPct * 10) / 10,
    odometerKm: Math.round(s.odo),
    location: describeLocation(s, s.mode === 'route' && s.route ? s.route.road : undefined),
    routeId: s.route?.id ?? null,
    routeDir: s.dir,
    progressM: s.progressM,
    routeLengthM: len,
    remainingKm: Math.round(remainingM / 100) / 10,
    etaTs,
    tripId: s.tripId,
    lastFixTs: s.lastFixTs,
    limitKph: limit,
    speeding: s.speed > limit + 5,
    delayed: trip?.status === 'delayed',
  }
}

function tick() {
  const now = Date.now()
  const settings = useSettings.getState().simulation
  const dt = Math.min(10, lastTickAt ? (now - lastTickAt) / 1000 : settings.intervalMs / 1000)
  lastTickAt = now
  tickN++
  const { vehicles } = db()
  const vMap = new Map(vehicles.map((v) => [v.id, v]))

  // add sim entries for vehicles registered after start, drop deleted ones
  const snapshot = sims.size === 0 ? loadSnapshot() : {}
  for (const v of vehicles) if (!sims.has(v.id)) sims.set(v.id, initVehicle(v, db().trips, snapshot, now))
  for (const id of [...sims.keys()]) if (!vMap.has(id)) { sims.delete(id); fixBuffer.delete(id) }

  const out: Record<string, Telemetry> = {}
  const trips = db().trips
  for (const s of sims.values()) {
    const v = vMap.get(s.id)!
    applyAdminState(s, v)
    stepVehicle(s, v, dt, settings.timeScale, now)
    if (s.gpsOnline) {
      s.lastFixTs = now
      const fix: Fix = { lat: s.lat, lng: s.lng, heading: s.heading, speed: s.speed, at: now }
      const prev = fixBuffer.get(s.id)
      fixBuffer.set(s.id, { prev: prev ? prev.curr : fix, curr: fix })
      if (settings.events) checkAlerts(s, v, now)
    } else if (!fixBuffer.has(s.id)) {
      const fix: Fix = { lat: s.lat, lng: s.lng, heading: s.heading, speed: 0, at: now }
      fixBuffer.set(s.id, { prev: fix, curr: fix })
    }
    out[s.id] = toTelemetry(s, v, trips, now, settings.timeScale)
  }
  useLive.getState().setTelemetry(out)
  if (tickN % 8 === 0) saveSnapshot()
}

function schedule() {
  const interval = useSettings.getState().simulation.intervalMs
  currentInterval = interval
  clearInterval(timer)
  timer = setInterval(tick, interval)
}

let unsubSettings: (() => void) | undefined

export function startSimulation() {
  if (timer) return
  rng = createRng((Date.now() & 0xffffff) + 17)
  lastTickAt = 0
  tick() // immediate first fix so the UI is populated at once
  schedule()
  useLive.getState().setRunning(true)
  unsubSettings = useSettings.subscribe((s, prev) => {
    if (s.simulation.intervalMs !== prev.simulation.intervalMs && timer) schedule()
    if (s.simulation.enabled !== prev.simulation.enabled) {
      if (s.simulation.enabled) {
        if (!timer) schedule()
      } else {
        clearInterval(timer)
        timer = undefined
        useLive.getState().setRunning(false)
      }
    }
  })
  window.addEventListener('beforeunload', saveSnapshot)
}

export function stopSimulation() {
  clearInterval(timer)
  timer = undefined
  unsubSettings?.()
  saveSnapshot()
  useLive.getState().setRunning(false)
}

export function isSimulationRunning() {
  return !!timer
}

export function resumeSimulation() {
  if (!timer) {
    lastTickAt = Date.now()
    schedule()
    useLive.getState().setRunning(true)
  }
}

export function currentIntervalMs() {
  return currentInterval
}

/** Dev/diagnostics: positions of every simulated vehicle. */
export function debugSims() {
  return [...sims.values()]
}
