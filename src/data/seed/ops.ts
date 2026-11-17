import type { CargoType, Customer, Place, Shipment, ShipmentMilestone, ShipmentStatus, Trip, Vehicle, VehicleCategory } from '@/types'
import { createRng, type Rng } from '@/lib/rng'
import { ROUTE_BY_ID, routeEndpoints, type Route } from '../routes'
import { CARGO, CUSTOMER_SEEDS, DELAY_REASONS, FIRST_NAMES_F, FIRST_NAMES_M, SURNAMES } from './names'
import { BRANCH_SEEDS } from './org'
import type { FleetSeed } from './fleet'

const DAY = 864e5
const MIN = 6e4

const CITY_COORDS: Record<string, [number, number]> = {
  Harare: [-17.8292, 31.0522], Bulawayo: [-20.15, 28.5833], Mutare: [-18.9707, 32.6709], Gweru: [-19.45, 29.8167],
  Kwekwe: [-18.9281, 29.8149], Masvingo: [-20.0632, 30.8328], Chinhoyi: [-17.3667, 30.2], Beitbridge: [-22.2167, 30.0],
}

export function buildCustomers(now: number): Customer[] {
  const rng = createRng(77)
  return CUSTOMER_SEEDS.map((c, i) => {
    const [lat, lng] = CITY_COORDS[c.city]!
    const first = rng.pick([...FIRST_NAMES_M, ...FIRST_NAMES_F])
    const last = rng.pick(SURNAMES)
    const slug = c.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 2).join('')
    return {
      id: `cus-${String(i + 1).padStart(3, '0')}`,
      name: c.name,
      code: `C${1000 + i * 13}`,
      industry: c.industry,
      contactName: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${slug}.co.zw`,
      phone: `+263 24${rng.int(2, 8)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
      city: c.city,
      address: `${rng.int(1, 120)} ${rng.pick(['Industrial', 'Commerce', 'Workshop', 'Enterprise'])} Rd, ${c.city}`,
      lat: lat + rng.float(-0.012, 0.012),
      lng: lng + rng.float(-0.012, 0.012),
      creditLimitUsd: rng.pick([15000, 25000, 40000, 60000, 100000, 150000]),
      paymentTermsDays: rng.pick([14, 30, 30, 45, 60]),
      status: i === 17 ? 'on_hold' : i === 19 ? 'inactive' : 'active',
      createdAt: new Date(now - rng.int(120, 1100) * DAY).toISOString(),
    }
  })
}

/** Routes each depot can plausibly serve (own region first). */
const BRANCH_ROUTES: Record<string, string[]> = {
  'br-hre': ['R-HRE-C1', 'R-HRE-C4', 'R-HRE-C5', 'R-HRE-BYO', 'R-HRE-MUT', 'R-HRE-CHI'],
  'br-sou': ['R-HRE-C2', 'R-HRE-C3', 'R-HRE-MSV', 'R-HRE-KWE'],
  'br-byo': ['R-BYO-C1', 'R-BYO-C2', 'R-BYO-GWE', 'R-BYO-BBR', 'R-HRE-BYO'],
  'br-mut': ['R-MUT-C1', 'R-HRE-MUT'],
  'br-gwe': ['R-GWE-C1', 'R-KWE-GWE', 'R-GWE-MSV', 'R-BYO-GWE'],
  'br-kwe': ['R-HRE-KWE', 'R-KWE-GWE'],
  'br-msv': ['R-MSV-C1', 'R-HRE-MSV', 'R-MSV-BBR', 'R-GWE-MSV'],
  'br-chi': ['R-HRE-CHI'],
  'br-bbr': ['R-BBR-C1', 'R-MSV-BBR', 'R-BYO-BBR'],
  'br-wks': ['R-HRE-C3', 'R-HRE-C1', 'R-HRE-C2'],
}

const CITY_OF_ROUTE = (id: string) =>
  ({ HRE: 'Harare', BYO: 'Bulawayo', MUT: 'Mutare', GWE: 'Gweru', KWE: 'Kwekwe', MSV: 'Masvingo', CHI: 'Chinhoyi', BBR: 'Beitbridge' } as Record<string, string>)[id.split('-')[1]!] ?? 'Harare'

const AVG_SPEED: Record<VehicleCategory, number> = {
  heavy_truck: 62, tanker: 60, refrigerated: 68, bus: 72, light_truck: 74, delivery_van: 80, pickup: 84, service: 80, motorcycle: 55,
}
const RATE_PER_KM: Record<VehicleCategory, number> = {
  heavy_truck: 1.6, tanker: 1.85, refrigerated: 1.72, bus: 1.1, light_truck: 1.02, delivery_van: 0.8, pickup: 0.68, service: 0, motorcycle: 0.55,
}
const CARGO_FOR: Record<VehicleCategory, CargoType[]> = {
  heavy_truck: ['general', 'bulk', 'containers', 'general', 'equipment'],
  light_truck: ['general', 'general', 'equipment'],
  delivery_van: ['general'],
  pickup: ['equipment', 'general'],
  bus: ['passengers'],
  tanker: ['fuel'],
  refrigerated: ['perishable'],
  service: ['equipment'],
  motorcycle: ['general'],
}

export interface OpsSeed {
  customers: Customer[]
  trips: Trip[]
  shipments: Shipment[]
}

export function buildOps(now: number, fleet: FleetSeed, customers: Customer[]): OpsSeed {
  const rng = createRng(4242)
  const iso = (t: number) => new Date(t).toISOString()
  const { vehicles, drivers, plans } = fleet
  const custByCity = new Map<string, Customer[]>()
  for (const c of customers.filter((c) => c.status === 'active')) custByCity.set(c.city, [...(custByCity.get(c.city) ?? []), c])
  const activeCustomers = customers.filter((c) => c.status === 'active')

  const trips: Trip[] = []

  const placeFor = (route: Route, dir: 1 | -1, end: 'from' | 'to', cust?: Customer): Place => {
    const ep = routeEndpoints(route, dir)
    const name = end === 'from' ? ep.fromName : ep.toName
    const city = route.kind === 'highway' ? name : CITY_OF_ROUTE(route.id)
    const pt = end === 'from' ? ep.from : ep.to
    if (cust && cust.city === city) return { name: `${cust.name} – ${route.kind === 'city' ? name : city}`, city, lat: pt.lat, lng: pt.lng }
    return { name: route.kind === 'city' ? `${name}, ${city}` : `${city} Depot`, city, lat: pt.lat, lng: pt.lng }
  }

  const durationMin = (route: Route, cat: VehicleCategory) =>
    Math.round(route.kind === 'highway' ? (route.lengthM / 1000 / AVG_SPEED[cat]) * 60 + 25 : (route.lengthM / 1000 / 24) * 60 + 35)

  let seq = 0
  const mk = (o: {
    vehicle: Vehicle | null
    driverId: string | null
    route: Route
    dir: 1 | -1
    status: Trip['status']
    start: number
    progress?: number
    customer?: Customer
    cargoType?: CargoType
    priority?: Trip['priority']
    delayed?: boolean
    branchId?: string
  }): Trip => {
    const cat = o.vehicle?.category ?? 'heavy_truck'
    const cust = o.customer ?? (cat === 'service' ? undefined : pickCustomer(rng, o.route, o.dir, custByCity, activeCustomers))
    const ct = o.cargoType ?? rng.pick(CARGO_FOR[cat])
    const plannedMin = durationMin(o.route, cat)
    const distKm = Math.round((o.route.lengthM / 1000) * (o.route.kind === 'city' ? rng.float(1, 1.15) : 1) * 10) / 10
    const origin = placeFor(o.route, o.dir, 'from')
    const destination = placeFor(o.route, o.dir, 'to', cust)
    const weight = ct === 'passengers' ? rng.int(1500, 4200) : Math.round(((o.vehicle?.loadCapacityKg ?? 20000) * rng.float(0.45, 0.98)) / 50) * 50
    const revenue = cat === 'service' ? 0 : Math.round((distKm * RATE_PER_KM[cat] * rng.float(0.92, 1.18) + (o.route.kind === 'city' ? 55 : 120)) / 5) * 5
    const scheduledStart = o.start
    const plannedEnd = scheduledStart + plannedMin * MIN
    const base: Trip = {
      id: `trp-${String(++seq).padStart(4, '0')}`,
      ref: '',
      status: o.status,
      vehicleId: o.vehicle?.id ?? null,
      driverId: o.driverId,
      customerId: cust?.id ?? null,
      shipmentId: null,
      branchId: o.branchId ?? o.vehicle?.branchId ?? 'br-hre',
      routeId: o.route.id,
      routeDir: o.dir,
      origin,
      destination,
      cargoType: ct,
      cargoDescription: rng.pick(CARGO[ct]!),
      cargoWeightKg: weight,
      scheduledStart: iso(scheduledStart),
      actualStart: null,
      plannedEnd: iso(plannedEnd),
      actualEnd: null,
      plannedDistanceKm: distKm,
      actualDistanceKm: null,
      plannedDurationMin: plannedMin,
      actualDurationMin: null,
      delayMinutes: 0,
      expensesUsd: 0,
      revenueUsd: revenue,
      pod: null,
      priority: o.priority ?? rng.weighted([['normal', 8], ['high', 3], ['low', 2], ['urgent', 1]] as const),
      createdAt: iso(scheduledStart - rng.int(1, 5) * DAY),
    }
    if (o.status === 'completed') {
      const late = rng.chance(0.2)
      const factor = late ? rng.float(1.15, 1.6) : rng.float(0.88, 1.1)
      const actualMin = Math.round(plannedMin * factor)
      base.actualStart = iso(scheduledStart + rng.int(-5, late ? 40 : 15) * MIN)
      base.actualDurationMin = actualMin
      base.actualEnd = iso(new Date(base.actualStart).getTime() + actualMin * MIN)
      base.actualDistanceKm = Math.round(distKm * rng.float(0.99, 1.06) * 10) / 10
      base.delayMinutes = Math.max(0, actualMin - plannedMin)
      if (base.delayMinutes > 30) base.delayReason = rng.pick(DELAY_REASONS)
      if (cat !== 'service')
        base.pod = {
          receivedBy: `${rng.pick([...FIRST_NAMES_M, ...FIRST_NAMES_F])} ${rng.pick(SURNAMES)}`,
          signedAt: base.actualEnd,
          photoCount: rng.int(1, 3),
          conditionOk: rng.chance(0.95),
          notes: rng.chance(0.2) ? 'Delivered in full, goods checked against delivery note.' : undefined,
        }
    } else if (o.status === 'in_transit' || o.status === 'delayed') {
      const p = o.progress ?? 0.5
      base.actualStart = iso(now - p * plannedMin * MIN * rng.float(0.97, 1.03))
      if (o.status === 'delayed') {
        base.delayMinutes = rng.int(25, 140)
        base.delayReason = rng.pick(DELAY_REASONS)
      }
      base.scheduledStart = base.actualStart
      base.plannedEnd = iso(new Date(base.actualStart).getTime() + plannedMin * MIN)
    } else if (o.status === 'cancelled') {
      base.delayReason = rng.pick(['Customer cancelled order', 'Cargo not ready at pickup', 'Vehicle unavailable – reassigned', 'Duplicate booking'])
    }
    trips.push(base)
    return base
  }

  const driverOf = (v: Vehicle) => v.driverId
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]))

  // ---- current trips (drive the live simulation) --------------------------
  const currentTripByVehicle = new Map<string, Trip>()
  for (const v of vehicles) {
    const plan = plans.get(v.id)!
    if (!plan.route) continue
    if (plan.plan !== 'moving' && plan.plan !== 'offline_route') continue
    const route = ROUTE_BY_ID[plan.route]!
    const progress = plan.progress ?? rng.float(0.08, 0.88)
    const t = mk({
      vehicle: v,
      driverId: driverOf(v),
      route,
      dir: plan.dir ?? 1,
      status: plan.delayed ? 'delayed' : 'in_transit',
      start: now,
      progress,
      priority: plan.delayed ? 'high' : undefined,
    })
    currentTripByVehicle.set(v.id, t)
  }

  // ---- upcoming trips -------------------------------------------------------
  // next legs for in-flight vehicles (reverse direction, scheduled after current plannedEnd)
  let scheduledCount = 0
  for (const v of vehicles) {
    const cur = currentTripByVehicle.get(v.id)
    if (!cur || scheduledCount >= 16) continue
    if (!rng.chance(0.55)) continue
    const route = ROUTE_BY_ID[cur.routeId]!
    mk({ vehicle: v, driverId: driverOf(v), route, dir: (cur.routeDir === 1 ? -1 : 1) as 1 | -1, status: 'scheduled', start: new Date(cur.plannedEnd).getTime() + rng.int(60, 240) * MIN })
    scheduledCount++
  }
  // parked vehicles get a ready-for-dispatch trip or a scheduled trip
  const parked = vehicles.filter((v) => ['idle', 'stopped', 'offline_parked'].includes(plans.get(v.id)!.plan))
  parked.forEach((v, i) => {
    const routes = BRANCH_ROUTES[v.branchId]!.map((id) => ROUTE_BY_ID[id]!)
    const route = routes[i % routes.length]!
    if (i < 8) {
      mk({ vehicle: v, driverId: driverOf(v), route, dir: rng.pick([1, -1] as const), status: 'ready', start: now + rng.int(20, 200) * MIN })
    } else {
      mk({ vehicle: v, driverId: driverOf(v), route, dir: 1, status: 'scheduled', start: now + rng.int(1, 3) * DAY + rng.int(0, 8) * 36e5 })
    }
  })
  // a few more scheduled trips for random active vehicles
  for (let i = 0; i < 4; i++) {
    const v = rng.pick(vehicles.filter((x) => x.status === 'active' && x.category !== 'service'))
    const routes = BRANCH_ROUTES[v.branchId]!.map((id) => ROUTE_BY_ID[id]!)
    mk({ vehicle: v, driverId: driverOf(v), route: rng.pick(routes), dir: rng.pick([1, -1] as const), status: 'scheduled', start: now + rng.int(1, 6) * DAY + rng.int(0, 8) * 36e5 })
  }
  // awaiting assignment: no vehicle / driver yet
  const regionBranches = BRANCH_SEEDS.filter((b) => b.type !== 'workshop')
  for (let i = 0; i < 9; i++) {
    const b = rng.pick(regionBranches)
    const route = ROUTE_BY_ID[rng.pick(BRANCH_ROUTES[b.id]!)]!
    const t = mk({ vehicle: null, driverId: null, route, dir: rng.pick([1, -1] as const), status: 'awaiting_assignment', start: now + rng.int(1, 5) * DAY + rng.int(0, 8) * 36e5, branchId: b.id, cargoType: rng.pick(['general', 'bulk', 'perishable', 'fuel', 'containers'] as const) })
    t.cargoWeightKg = rng.int(2, 28) * 1000
  }

  // ---- history (120 days of completed trips + a few cancellations) ---------
  const HISTORY_DAYS = 118
  for (const v of vehicles) {
    const plan = plans.get(v.id)!
    const own = plan.route ? [ROUTE_BY_ID[plan.route]!] : []
    const branchRoutes = BRANCH_ROUTES[v.branchId]!.map((id) => ROUTE_BY_ID[id]!)
    const maintenanceVeh = plan.plan === 'maintenance' || plan.plan === 'out_of_service'
    const cityVeh = plan.route ? ROUTE_BY_ID[plan.route]!.kind === 'city' : branchRoutes[0]!.kind === 'city'
    const target = v.category === 'service' ? rng.int(14, 22) : maintenanceVeh ? rng.int(10, 18) : cityVeh ? rng.int(58, 84) : rng.int(30, 42)
    // most recent history ends before the current trip began; vehicles in the workshop have older last trips
    const newest = now - (maintenanceVeh ? rng.int(3, 12) : currentTripByVehicle.has(v.id) ? 0.4 : 0.1) * DAY
    const starts = Array.from({ length: target }, () => newest - rng.float(0.2, HISTORY_DAYS) * DAY).sort((a, b) => a - b)
    let freeAt = 0
    for (const raw of starts) {
      const d = new Date(raw)
      if (d.getDay() === 0 && rng.chance(0.75)) continue // few Sunday trips
      d.setHours(rng.int(5, 14), rng.int(0, 59), 0, 0)
      const route = own.length && rng.chance(0.65) ? own[0]! : rng.pick(branchRoutes)
      const start = Math.max(d.getTime(), freeAt)
      const dur = durationMin(route, v.category) * MIN * rng.float(1, 1.15)
      if (start + dur > newest) continue
      const status: Trip['status'] = rng.chance(0.02) ? 'cancelled' : 'completed'
      mk({ vehicle: v, driverId: v.driverId ?? rng.pick(drivers).id, route, dir: rng.pick([1, -1] as const), status, start })
      freeAt = start + dur * 1.25 + 90 * MIN
    }
  }

  // ---- order + refs ----------------------------------------------------------
  trips.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  trips.forEach((t, i) => {
    t.ref = `TRP-${new Date(t.scheduledStart).getFullYear()}-${String(10240 + i).padStart(5, '0')}`
  })

  // ---- shipments -------------------------------------------------------------
  const shipments: Shipment[] = []
  let shipSeq = 0
  const milestone = (key: ShipmentMilestone['key'], label: string, at: number | null, note?: string): ShipmentMilestone => ({ key, label, at: at === null ? null : iso(at), note })
  const buildMilestones = (status: ShipmentStatus, t: Trip, createdAt: number): ShipmentMilestone[] => {
    const start = t.actualStart ? new Date(t.actualStart).getTime() : new Date(t.scheduledStart).getTime()
    const end = t.actualEnd ? new Date(t.actualEnd).getTime() : new Date(t.plannedEnd).getTime()
    const order: ShipmentStatus[] = ['registered', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered']
    const reached = status === 'exception' ? 4 : order.indexOf(status)
    const times = [createdAt, createdAt + rng.int(1, 8) * 36e5, start + 15 * MIN, start + 45 * MIN, Math.max(start + 60 * MIN, end - 40 * MIN), end]
    const labels = ['Shipment registered', 'Vehicle & driver allocated', 'Picked up from origin', 'In transit', 'Out for delivery', 'Delivered']
    return order.map((k, i) => milestone(k as ShipmentMilestone['key'], labels[i]!, i <= reached ? times[i]! : null))
  }
  const shipTripStatus = (t: Trip): ShipmentStatus => {
    switch (t.status) {
      case 'completed': return 'delivered'
      case 'in_transit': return 'in_transit'
      case 'delayed': return 'in_transit'
      case 'ready': return 'allocated'
      case 'scheduled': return 'allocated'
      default: return 'registered'
    }
  }
  const eligible = trips.filter((t) => t.customerId && t.status !== 'cancelled' && t.cargoType !== 'passengers')
  for (const t of eligible) {
    const p = t.status === 'completed' ? 0.14 : 0.75
    if (!rng.chance(p) || shipments.length >= 300) continue
    let status = shipTripStatus(t)
    if (status === 'in_transit' && rng.chance(0.25)) status = 'out_for_delivery'
    const createdAt = new Date(t.scheduledStart).getTime() - rng.int(1, 4) * DAY
    const cust = customers.find((c) => c.id === t.customerId)!
    const hasExc = rng.chance(t.status === 'completed' ? 0.06 : 0.08)
    const exc = hasExc
      ? {
          type: rng.pick(['Damaged goods', 'Short delivery', 'Customer unavailable', 'Border documentation hold', 'Delivery address query']),
          description: '',
          raisedAt: iso(new Date(t.actualStart ?? t.scheduledStart).getTime() + 3 * 36e5),
          resolved: t.status === 'completed',
        }
      : null
    if (exc) {
      exc.description = {
        'Damaged goods': 'Customer reported damaged cartons on offloading; photos attached and claim opened.',
        'Short delivery': 'Quantity received lower than waybill by 6 units; reconciliation in progress.',
        'Customer unavailable': 'Receiving party unavailable at the delivery window; redelivery arranged.',
        'Border documentation hold': 'Cargo held pending ZIMRA clearance documents.',
        'Delivery address query': 'Delivery location clarification requested from customer.',
      }[exc.type]!
      if (!exc.resolved && t.status !== 'completed') status = 'exception'
    }
    const s: Shipment = {
      id: `shp-${String(++shipSeq).padStart(4, '0')}`,
      trackingRef: `ZFL-${rng.int(1000000, 9999999)}`,
      customerId: cust.id,
      tripId: t.id,
      vehicleId: t.vehicleId,
      driverId: t.driverId,
      branchId: t.branchId,
      status,
      cargoDescription: t.cargoDescription,
      cargoType: t.cargoType,
      weightKg: t.cargoWeightKg,
      packages: t.cargoType === 'bulk' || t.cargoType === 'fuel' ? 1 : rng.int(4, 480),
      declaredValueUsd: Math.round(t.cargoWeightKg * rng.float(0.4, 3.5) / 50) * 50,
      chargeUsd: t.revenueUsd,
      pickup: t.origin,
      delivery: t.destination,
      pickupWindowStart: t.scheduledStart,
      deliveryEta: t.actualEnd ?? t.plannedEnd,
      deliveredAt: status === 'delivered' ? t.actualEnd : null,
      milestones: [],
      exception: exc,
      pod: status === 'delivered' ? t.pod : null,
      contactName: cust.contactName,
      contactPhone: cust.phone,
      createdAt: iso(createdAt),
    }
    s.milestones = buildMilestones(status, t, createdAt)
    if (exc) s.milestones.push(milestone('exception', `Exception – ${exc.type}`, new Date(exc.raisedAt).getTime(), exc.description))
    t.shipmentId = s.id
    shipments.push(s)
  }
  // unallocated shipments awaiting a vehicle
  for (let i = 0; i < 14; i++) {
    const cust = rng.pick(activeCustomers)
    const b = BRANCH_SEEDS.find((x) => x.city === cust.city && x.type !== 'workshop') ?? BRANCH_SEEDS[0]!
    const dest = rng.pick(activeCustomers.filter((c) => c.id !== cust.id))
    const ct = rng.pick(['general', 'bulk', 'perishable', 'containers', 'equipment'] as const)
    const createdAt = now - rng.int(1, 40) * 36e5
    const eta = now + rng.int(1, 5) * DAY
    shipments.push({
      id: `shp-${String(++shipSeq).padStart(4, '0')}`,
      trackingRef: `ZFL-${rng.int(1000000, 9999999)}`,
      customerId: cust.id,
      tripId: null,
      vehicleId: null,
      driverId: null,
      branchId: b.id,
      status: 'registered',
      cargoDescription: rng.pick(CARGO[ct]!),
      cargoType: ct,
      weightKg: rng.int(800, 24000),
      packages: rng.int(2, 300),
      declaredValueUsd: rng.int(3, 120) * 500,
      chargeUsd: rng.int(180, 2600),
      pickup: { name: `${cust.name} – ${cust.city}`, city: cust.city, lat: cust.lat, lng: cust.lng },
      delivery: { name: `${dest.name} – ${dest.city}`, city: dest.city, lat: dest.lat, lng: dest.lng },
      pickupWindowStart: iso(now + rng.int(4, 40) * 36e5),
      deliveryEta: iso(eta),
      deliveredAt: null,
      milestones: [milestone('registered', 'Shipment registered', createdAt), milestone('allocated', 'Vehicle & driver allocated', null), milestone('picked_up', 'Picked up from origin', null), milestone('in_transit', 'In transit', null), milestone('out_for_delivery', 'Out for delivery', null), milestone('delivered', 'Delivered', null)],
      exception: null,
      pod: null,
      contactName: cust.contactName,
      contactPhone: cust.phone,
      createdAt: iso(createdAt),
    })
  }

  void vehiclesById
  return { customers, trips, shipments }
}

function pickCustomer(rng: Rng, route: Route, dir: 1 | -1, byCity: Map<string, Customer[]>, all: Customer[]) {
  const ep = routeEndpoints(route, dir)
  const city = route.kind === 'highway' ? ep.toName : CITY_OF_ROUTE(route.id)
  const local = byCity.get(city)
  return local && rng.chance(0.75) ? rng.pick(local) : rng.pick(all)
}
