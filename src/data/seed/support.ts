import type {
  DailyStat, FuelStation, FuelTransaction, Incident, IncidentType, Inspection, PartUsage, SafetyEvent, SafetyEventType, ServiceProvider, ServiceSchedule, Trip, Vehicle, VehicleCategory, WorkOrder, WorkOrderType,
} from '@/types'
import { createRng } from '@/lib/rng'
import { describeLocation } from '../places'
import { ROUTE_BY_ID, pointAt } from '../routes'
import { BRANCH_SEEDS } from './org'
import type { FleetSeed } from './fleet'

const DAY = 864e5
const HOUR = 36e5
const MIN = 6e4

export const FUEL_STATIONS: FuelStation[] = [
  { id: 'fs-01', name: 'Puma Energy Msasa', brand: 'Puma Energy', city: 'Harare', address: 'Mutare Rd, Msasa, Harare', lat: -17.8395, lng: 31.1105, dieselPriceUsd: 1.62, petrolPriceUsd: 1.54, status: 'approved' },
  { id: 'fs-02', name: 'Zuva Southerton', brand: 'Zuva Petroleum', city: 'Harare', address: 'Coventry Rd, Southerton, Harare', lat: -17.8655, lng: 31.0195, dieselPriceUsd: 1.6, petrolPriceUsd: 1.52, status: 'approved' },
  { id: 'fs-03', name: 'TotalEnergies Lytton Rd', brand: 'TotalEnergies', city: 'Harare', address: 'Lytton Rd, Workington, Harare', lat: -17.8485, lng: 31.025, dieselPriceUsd: 1.66, petrolPriceUsd: 1.57, status: 'approved' },
  { id: 'fs-04', name: 'Puma Energy Belmont', brand: 'Puma Energy', city: 'Bulawayo', address: 'Sidojiwe Rd, Belmont, Bulawayo', lat: -20.1715, lng: 28.556, dieselPriceUsd: 1.64, petrolPriceUsd: 1.55, status: 'approved' },
  { id: 'fs-05', name: 'Zuva Bulawayo CBD', brand: 'Zuva Petroleum', city: 'Bulawayo', address: 'Fife St, Bulawayo', lat: -20.153, lng: 28.585, dieselPriceUsd: 1.63, petrolPriceUsd: 1.54, status: 'approved' },
  { id: 'fs-06', name: 'TotalEnergies Mutare', brand: 'TotalEnergies', city: 'Mutare', address: 'Herbert Chitepo St, Mutare', lat: -18.972, lng: 32.668, dieselPriceUsd: 1.67, petrolPriceUsd: 1.58, status: 'approved' },
  { id: 'fs-07', name: 'Puma Energy Gweru', brand: 'Puma Energy', city: 'Gweru', address: 'Main St, Gweru', lat: -19.452, lng: 29.82, dieselPriceUsd: 1.65, petrolPriceUsd: 1.56, status: 'approved' },
  { id: 'fs-08', name: 'Zuva Kwekwe', brand: 'Zuva Petroleum', city: 'Kwekwe', address: 'Robert Mugabe Way, Kwekwe', lat: -18.93, lng: 29.816, dieselPriceUsd: 1.64, petrolPriceUsd: 1.55, status: 'approved' },
  { id: 'fs-09', name: 'Puma Energy Masvingo', brand: 'Puma Energy', city: 'Masvingo', address: 'Hughes St, Masvingo', lat: -20.066, lng: 30.835, dieselPriceUsd: 1.68, petrolPriceUsd: 1.59, status: 'approved' },
  { id: 'fs-10', name: 'TotalEnergies Chinhoyi', brand: 'TotalEnergies', city: 'Chinhoyi', address: 'Harare–Chirundu Rd, Chinhoyi', lat: -17.368, lng: 30.195, dieselPriceUsd: 1.66, petrolPriceUsd: 1.57, status: 'approved' },
  { id: 'fs-11', name: 'Puma Energy Beitbridge', brand: 'Puma Energy', city: 'Beitbridge', address: 'Main Rd, Beitbridge', lat: -22.215, lng: 30.0, dieselPriceUsd: 1.7, petrolPriceUsd: 1.61, status: 'approved' },
  { id: 'fs-12', name: 'Zuva Border Plaza', brand: 'Zuva Petroleum', city: 'Beitbridge', address: 'Border Rd, Beitbridge', lat: -22.223, lng: 29.99, dieselPriceUsd: 1.71, petrolPriceUsd: 1.62, status: 'approved' },
  { id: 'fs-13', name: 'TotalEnergies Kadoma', brand: 'TotalEnergies', city: 'Kadoma', address: 'A5 Highway, Kadoma', lat: -18.335, lng: 29.915, dieselPriceUsd: 1.65, petrolPriceUsd: 1.56, status: 'approved' },
  { id: 'fs-14', name: 'Roadside Fuels Chivhu', brand: 'Independent', city: 'Chivhu', address: 'A4 Highway, Chivhu', lat: -19.022, lng: 30.888, dieselPriceUsd: 1.58, petrolPriceUsd: 1.5, status: 'suspended' },
]

const STATION_BY_CITY: Record<string, string[]> = {
  Harare: ['fs-01', 'fs-02', 'fs-03'], Bulawayo: ['fs-04', 'fs-05'], Mutare: ['fs-06'], Gweru: ['fs-07'], Kwekwe: ['fs-08'], Masvingo: ['fs-09'], Chinhoyi: ['fs-10'], Beitbridge: ['fs-11', 'fs-12'],
}

const L_PER_100: Record<VehicleCategory, number> = { heavy_truck: 38, tanker: 40, refrigerated: 24, bus: 30, light_truck: 18, delivery_van: 12, pickup: 11, service: 11, motorcycle: 3.5 }

export function buildFuel(now: number, fleet: FleetSeed, trips: Trip[]): FuelTransaction[] {
  const rng = createRng(909)
  const txs: FuelTransaction[] = []
  const vehicleById = new Map(fleet.vehicles.map((v) => [v.id, v]))
  const cardByVehicle = new Map(fleet.fuelCards.filter((c) => c.vehicleId).map((c) => [c.vehicleId!, c.id]))
  const completed = trips.filter((t) => t.status === 'completed' && t.vehicleId)
  const byVehicle = new Map<string, Trip[]>()
  for (const t of completed) byVehicle.set(t.vehicleId!, [...(byVehicle.get(t.vehicleId!) ?? []), t])

  // helper: km driven by vehicle after time t (completed trips only)
  const kmAfter = (vid: string, t: number) => (byVehicle.get(vid) ?? []).filter((x) => new Date(x.actualEnd!).getTime() > t).reduce((s, x) => s + (x.actualDistanceKm ?? 0), 0)

  const push = (v: Vehicle, date: number, litres: number, trip: Trip | null, city: string) => {
    const stIds = STATION_BY_CITY[city] ?? ['fs-13']
    const stId = rng.pick(stIds)
    const st = FUEL_STATIONS.find((s) => s.id === stId)!
    const price = Math.round(((v.fuelType === 'petrol' ? st.petrolPriceUsd : st.dieselPriceUsd) + rng.float(-0.04, 0.04)) * 100) / 100
    const l = Math.round(litres * 10) / 10
    txs.push({
      id: '',
      ref: '',
      vehicleId: v.id,
      driverId: trip?.driverId ?? v.driverId,
      stationId: st.id,
      cardId: cardByVehicle.get(v.id) ?? null,
      branchId: v.branchId,
      tripId: trip?.id ?? null,
      date: new Date(date).toISOString(),
      litres: l,
      pricePerLitreUsd: price,
      totalUsd: Math.round(l * price * 100) / 100,
      odometerKm: Math.round(v.odometerKm - kmAfter(v.id, date)),
      fuelType: v.fuelType,
      fullTank: l > v.tankCapacityL * 0.6,
      flag: null,
      reconciled: date < now - 14 * DAY ? rng.chance(0.9) : rng.chance(0.15),
      receiptNo: `R${rng.int(100000, 999999)}`,
    })
  }

  for (const [vid, vTrips] of byVehicle) {
    const v = vehicleById.get(vid)!
    for (const t of vTrips) {
      const route = ROUTE_BY_ID[t.routeId]!
      if (route.kind !== 'highway') continue
      if (!rng.chance(0.85)) continue
      const need = ((t.actualDistanceKm ?? t.plannedDistanceKm) * L_PER_100[v.category]) / 100
      const litres = Math.min(v.tankCapacityL * 0.97, need * rng.float(0.75, 1.15))
      const when = new Date(t.actualStart!).getTime() + rng.float(0.15, 0.7) * (t.actualDurationMin ?? 120) * MIN
      const city = rng.chance(0.55) ? t.origin.city : t.destination.city
      push(v, when, litres, t, city)
    }
  }
  // city vehicles: periodic top ups
  for (const v of fleet.vehicles) {
    const plan = fleet.plans.get(v.id)!
    const route = plan.route ? ROUTE_BY_ID[plan.route] : null
    if (route && route.kind === 'highway') continue
    if (plan.plan === 'out_of_service') continue
    const city = BRANCH_SEEDS.find((b) => b.id === v.branchId)!.city
    const every = rng.int(5, 9)
    for (let d = rng.int(1, 6); d < 118; d += every + rng.int(-1, 2)) {
      const need = rng.float(0.45, 0.85) * v.tankCapacityL
      push(v, now - d * DAY - rng.int(0, 10) * HOUR, need, null, city)
    }
  }

  // chronological ids + refs
  txs.sort((a, b) => a.date.localeCompare(b.date))
  txs.forEach((t, i) => {
    t.id = `ftx-${String(i + 1).padStart(4, '0')}`
    t.ref = `FT-${String(30000 + i)}`
  })

  // flag suspicious transactions
  const candidates = rng.shuffle(txs.filter((t) => new Date(t.date).getTime() > now - 100 * DAY)).slice(0, 15)
  candidates.forEach((t, i) => {
    const v = vehicleById.get(t.vehicleId)!
    const kind = i % 5
    if (kind === 0) {
      t.litres = Math.round(v.tankCapacityL * rng.float(1.08, 1.3))
      t.totalUsd = Math.round(t.litres * t.pricePerLitreUsd * 100) / 100
      t.flag = { reason: `Litres (${t.litres} L) exceed tank capacity (${v.tankCapacityL} L)`, severity: 'high', expectedLitres: v.tankCapacityL }
    } else if (kind === 1) {
      const d = new Date(t.date)
      d.setHours(rng.int(0, 3), rng.int(0, 59))
      t.date = d.toISOString()
      t.flag = { reason: 'Transaction outside operating hours (00:00–04:00)', severity: 'medium' }
    } else if (kind === 2) {
      const expected = Math.round(t.litres / 1.38)
      t.flag = { reason: 'Consumption 38% above expected for distance driven', severity: 'high', expectedLitres: expected }
    } else if (kind === 3) {
      t.flag = { reason: 'Possible duplicate: second fill within 3 hours', severity: 'medium' }
    } else {
      t.flag = { reason: 'Odometer reading inconsistent with previous fill', severity: 'low' }
      t.odometerKm = t.odometerKm - rng.int(800, 2500)
    }
    t.reconciled = false
  })
  return txs
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------
export const PROVIDERS: ServiceProvider[] = [
  { id: 'prv-01', name: 'Central Workshop (Internal)', type: 'internal', city: 'Harare', specialties: ['Preventive maintenance', 'Engines', 'Brakes', 'Electrical'], contactName: 'Cosmas Bvuma', phone: '+263 242 753 900', email: 'workshop@zambezifreight.co.zw', rating: 4.6, status: 'preferred', hourlyRateUsd: 22 },
  { id: 'prv-02', name: 'Bulawayo Depot Bay (Internal)', type: 'internal', city: 'Bulawayo', specialties: ['Preventive maintenance', 'Tyres'], contactName: 'Thabani Khumalo', phone: '+263 292 889 410', email: 'bulawayo@zambezifreight.co.zw', rating: 4.3, status: 'preferred', hourlyRateUsd: 20 },
  { id: 'prv-03', name: 'Apex Truck Service Centre', type: 'external', city: 'Harare', specialties: ['Engines', 'Gearboxes', 'Heavy trucks'], contactName: 'Wellington Chuma', phone: '+263 242 662 118', email: 'service@apextruck.co.zw', rating: 4.7, status: 'preferred', hourlyRateUsd: 38 },
  { id: 'prv-04', name: 'Premier Tyre & Rubber', type: 'external', city: 'Harare', specialties: ['Tyres', 'Wheel alignment', 'Retreading'], contactName: 'Ronald Mavhunga', phone: '+263 242 790 301', email: 'fleet@premiertyre.co.zw', rating: 4.4, status: 'approved', hourlyRateUsd: 28 },
  { id: 'prv-05', name: 'Matabeleland Diesel Services', type: 'external', city: 'Bulawayo', specialties: ['Fuel systems', 'Turbochargers', 'Injectors'], contactName: 'Nkosana Moyo', phone: '+263 292 468 770', email: 'info@mds.co.zw', rating: 4.2, status: 'approved', hourlyRateUsd: 34 },
  { id: 'prv-06', name: 'Highfield Auto Electrical', type: 'external', city: 'Harare', specialties: ['Auto electrical', 'Alternators', 'Telematics install'], contactName: 'Innocent Zhou', phone: '+263 242 660 213', email: 'jobs@highfieldelec.co.zw', rating: 3.9, status: 'approved', hourlyRateUsd: 26 },
  { id: 'prv-07', name: 'Eastern Truck & Trailer Repairs', type: 'external', city: 'Mutare', specialties: ['Body repair', 'Trailers', 'Welding'], contactName: 'Tafadzwa Mutasa', phone: '+263 202 061 440', email: 'office@ettr.co.zw', rating: 4.1, status: 'approved', hourlyRateUsd: 30 },
  { id: 'prv-08', name: 'Southern Cross Refrigeration', type: 'external', city: 'Harare', specialties: ['Reefer units', 'Thermo King', 'Cold chain'], contactName: 'Precious Dube', phone: '+263 242 487 665', email: 'support@screfrig.co.zw', rating: 4.5, status: 'preferred', hourlyRateUsd: 40 },
]

const PARTS: { name: string; partNo: string; cost: [number, number] }[] = [
  { name: 'Engine oil 15W-40 (20 L)', partNo: 'OIL-1540-20', cost: [58, 78] },
  { name: 'Oil filter', partNo: 'FLT-OIL-114', cost: [14, 32] },
  { name: 'Air filter element', partNo: 'FLT-AIR-221', cost: [28, 64] },
  { name: 'Fuel filter / separator', partNo: 'FLT-FUE-330', cost: [22, 48] },
  { name: 'Brake pad set (axle)', partNo: 'BRK-PAD-A12', cost: [85, 190] },
  { name: 'Brake disc', partNo: 'BRK-DSC-77', cost: [95, 260] },
  { name: 'Tyre 315/80R22.5', partNo: 'TYR-315-80', cost: [310, 420] },
  { name: 'Tyre 195R15C', partNo: 'TYR-195-15', cost: [78, 120] },
  { name: 'Alternator 24V', partNo: 'ELE-ALT-24', cost: [210, 380] },
  { name: 'Battery 12V 180Ah', partNo: 'ELE-BAT-180', cost: [165, 240] },
  { name: 'Clutch kit', partNo: 'TRN-CLT-09', cost: [420, 980] },
  { name: 'Shock absorber', partNo: 'SUS-SHK-31', cost: [48, 130] },
  { name: 'Coolant (20 L)', partNo: 'CLT-20', cost: [26, 40] },
  { name: 'Water pump', partNo: 'ENG-WPM-18', cost: [90, 240] },
  { name: 'Starter motor', partNo: 'ELE-STR-12', cost: [180, 340] },
  { name: 'Hydraulic hose', partNo: 'HYD-HSE-5', cost: [30, 85] },
  { name: 'Turbocharger', partNo: 'ENG-TRB-07', cost: [950, 1900] },
]

const WO_TITLES: Record<WorkOrderType, string[]> = {
  preventive: ['Routine service (A)', 'Routine service (B)', 'Major service (C)', 'Lubrication & filter change', 'Service – 30,000 km'],
  corrective: ['Brake system repair', 'Cooling system leak', 'Suspension repair', 'Air conditioning repair', 'Exhaust repair', 'Electrical fault diagnosis'],
  breakdown: ['Roadside breakdown – recovery & repair', 'Engine overheating', 'Clutch failure', 'Fuel pump failure'],
  inspection: ['Roadworthiness inspection prep', 'Pre-season safety inspection'],
  tyre: ['Tyre replacement – drive axle', 'Tyre rotation & alignment', 'Puncture & tyre repair'],
  accident_repair: ['Panel beating & repaint', 'Windscreen & lights replacement', 'Chassis straightening'],
}

const SERVICE_KM: Record<VehicleCategory, number> = { heavy_truck: 20000, tanker: 20000, refrigerated: 15000, bus: 15000, light_truck: 12000, delivery_van: 10000, pickup: 10000, service: 10000, motorcycle: 6000 }

export interface MaintenanceSeed {
  providers: ServiceProvider[]
  workOrders: WorkOrder[]
  schedules: ServiceSchedule[]
  inspections: Inspection[]
}

export function buildMaintenance(now: number, fleet: FleetSeed): MaintenanceSeed {
  const rng = createRng(31337)
  const iso = (t: number) => new Date(t).toISOString()
  const { vehicles, plans } = fleet
  const workOrders: WorkOrder[] = []
  const providerFor = (v: Vehicle, type: WorkOrderType) => {
    if (type === 'tyre') return rng.pick(['prv-04', 'prv-02', 'prv-04'])
    if (v.category === 'refrigerated' && rng.chance(0.5)) return 'prv-08'
    if (type === 'preventive') return v.branchId === 'br-byo' ? 'prv-02' : rng.chance(0.7) ? 'prv-01' : 'prv-03'
    return rng.pick(['prv-01', 'prv-03', 'prv-05', 'prv-06', 'prv-07', 'prv-03'])
  }
  const requesters = ['Rudo Chigwedere', 'Sibusiso Ncube', 'Misheck Gwatidzo', 'Tariro Makoni', 'Cosmas Bvuma']
  const techs = ['Learnmore Hove', 'Freddy Dube', 'Cleopas Mhlanga', 'Prince Nyathi', 'Edmore Mutasa', 'Shingirai Moyo']

  const makeWo = (v: Vehicle, type: WorkOrderType, status: WorkOrder['status'], when: number, priority?: WorkOrder['priority']): WorkOrder => {
    const heavy = ['heavy_truck', 'tanker', 'bus'].includes(v.category)
    const nParts = type === 'inspection' ? 1 : rng.int(1, type === 'preventive' ? 4 : 3)
    const parts: PartUsage[] = []
    for (let i = 0; i < nParts; i++) {
      const p = rng.pick(type === 'tyre' ? PARTS.filter((x) => x.name.startsWith('Tyre')) : type === 'preventive' ? PARTS.slice(0, 5) : PARTS)
      parts.push({ name: p.name, partNo: p.partNo, qty: p.name.startsWith('Tyre') ? rng.int(1, 4) : rng.int(1, 2), unitCostUsd: Math.round(rng.float(p.cost[0], p.cost[1]) * (heavy ? 1.15 : 1)) })
    }
    const partsCost = parts.reduce((s, p) => s + p.qty * p.unitCostUsd, 0)
    const providerId = providerFor(v, type)
    const hours = type === 'preventive' ? rng.float(2, 6) : type === 'accident_repair' ? rng.float(12, 60) : type === 'breakdown' ? rng.float(5, 20) : rng.float(2, 14)
    const labour = Math.round(hours * PROVIDERS.find((p) => p.id === providerId)!.hourlyRateUsd * (type === 'accident_repair' ? 1.3 : 1))
    const done = status === 'completed'
    const started = ['in_progress', 'completed'].includes(status)
    return {
      id: '',
      woNo: '',
      vehicleId: v.id,
      branchId: v.branchId,
      type,
      title: rng.pick(WO_TITLES[type]),
      description: type === 'preventive' ? 'Scheduled preventive maintenance per manufacturer service interval.' : 'Fault reported by driver / inspection; diagnosis and repair required.',
      priority: priority ?? (type === 'breakdown' ? 'critical' : type === 'accident_repair' ? 'high' : rng.weighted([['low', 2], ['medium', 6], ['high', 2]] as const)),
      status,
      providerId,
      requestedBy: rng.pick(requesters),
      technician: rng.pick(techs),
      requestedAt: iso(when - rng.int(1, 6) * DAY),
      scheduledDate: iso(when),
      startedAt: started ? iso(when + rng.int(0, 4) * HOUR) : null,
      completedAt: done ? iso(when + hours * HOUR + rng.int(1, 30) * HOUR * (type === 'accident_repair' ? 3 : 0.3)) : null,
      odometerKm: v.odometerKm - rng.int(500, 40000),
      downtimeHours: done ? Math.round(hours * rng.float(1.2, 3)) : 0,
      labourCostUsd: status === 'requested' || status === 'cancelled' ? 0 : labour,
      partsCostUsd: status === 'requested' || status === 'cancelled' ? 0 : partsCost,
      parts: status === 'requested' ? [] : parts,
    }
  }

  // vehicles currently in the workshop
  for (const v of vehicles.filter((x) => x.status === 'maintenance')) {
    const type = rng.pick(['corrective', 'breakdown', 'preventive', 'accident_repair'] as const)
    const wo = makeWo(v, type, 'in_progress', now - rng.int(1, 5) * DAY, 'high')
    wo.completedAt = null
    workOrders.push(wo)
  }
  const types: WorkOrderType[] = ['preventive', 'preventive', 'preventive', 'preventive', 'corrective', 'corrective', 'tyre', 'breakdown', 'inspection', 'accident_repair']
  const pool = vehicles.filter((v) => v.status === 'active')
  for (let i = 0; i < 52; i++) workOrders.push(makeWo(rng.pick(vehicles), rng.pick(types), 'completed', now - rng.float(1, 118) * DAY))
  for (let i = 0; i < 8; i++) workOrders.push(makeWo(rng.pick(pool), rng.pick(['preventive', 'preventive', 'tyre', 'corrective'] as const), 'scheduled', now + rng.int(1, 14) * DAY))
  for (let i = 0; i < 4; i++) workOrders.push(makeWo(rng.pick(pool), rng.pick(['corrective', 'preventive', 'tyre'] as const), 'approved', now + rng.int(1, 5) * DAY))
  for (let i = 0; i < 6; i++) workOrders.push(makeWo(rng.pick(pool), rng.pick(['corrective', 'corrective', 'breakdown', 'preventive'] as const), 'requested', now - rng.int(0, 3) * DAY))
  for (let i = 0; i < 2; i++) workOrders.push(makeWo(rng.pick(pool), 'corrective', 'cancelled', now - rng.int(10, 60) * DAY))

  workOrders.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
  workOrders.forEach((w, i) => {
    w.id = `wo-${String(i + 1).padStart(4, '0')}`
    w.woNo = `WO-${24000 + i + 1}`
  })

  // service schedules
  const schedules: ServiceSchedule[] = []
  let sn = 1
  for (const v of vehicles) {
    const tasks: { task: string; km: number; days: number; cost: number }[] = [
      { task: 'Routine service', km: SERVICE_KM[v.category], days: 90, cost: ['heavy_truck', 'tanker', 'bus'].includes(v.category) ? 520 : 260 },
      { task: 'Tyre inspection & rotation', km: SERVICE_KM[v.category] * 1.5, days: 120, cost: 90 },
    ]
    if (v.category === 'refrigerated') tasks.push({ task: 'Reefer unit service', km: 25000, days: 180, cost: 340 })
    if (['heavy_truck', 'tanker', 'bus'].includes(v.category)) tasks.push({ task: 'Brake system inspection', km: 30000, days: 180, cost: 220 })
    for (const t of tasks) {
      const bucket = rng.next()
      // fraction of interval elapsed: >1 means overdue
      const used = bucket < 0.13 ? rng.float(1.02, 1.3) : bucket < 0.35 ? rng.float(0.85, 0.99) : rng.float(0.1, 0.84)
      const lastKm = Math.max(0, Math.round(v.odometerKm - t.km * used))
      const lastDate = now - Math.round(t.days * used) * DAY
      schedules.push({
        id: `sch-${String(sn++).padStart(4, '0')}`,
        vehicleId: v.id,
        task: t.task,
        intervalKm: Math.round(t.km),
        intervalDays: t.days,
        lastServiceDate: iso(lastDate),
        lastServiceKm: lastKm,
        nextDueDate: iso(lastDate + t.days * DAY),
        nextDueKm: lastKm + Math.round(t.km),
        estCostUsd: t.cost,
      })
    }
  }

  // inspections
  const inspections: Inspection[] = []
  const items = ['Tyres & wheel nuts', 'Brakes & air system', 'Lights & indicators', 'Steering & suspension', 'Fluid levels & leaks', 'Mirrors & windscreen', 'Seat belts & cab', 'Fire extinguisher & triangles', 'Load securing / tarp', 'Documents on board']
  for (let i = 0; i < 64; i++) {
    const v = rng.pick(vehicles.filter((x) => plans.get(x.id)!.plan !== 'out_of_service'))
    const roll = rng.next()
    const result: Inspection['result'] = roll < 0.78 ? 'pass' : roll < 0.9 ? 'conditional' : 'fail'
    const failed = result === 'pass' ? 0 : result === 'conditional' ? 1 : rng.int(2, 3)
    const failIdx = new Set(rng.shuffle(items.map((_, k) => k)).slice(0, failed))
    const checklist = items.map((item, k) => ({ item, ok: !failIdx.has(k), note: failIdx.has(k) ? rng.pick(['Worn – replace soon', 'Leak observed', 'Not functioning', 'Missing / damaged']) : undefined }))
    inspections.push({
      id: `ins-${String(i + 1).padStart(4, '0')}`,
      ref: `INS-${5000 + i}`,
      vehicleId: v.id,
      driverId: v.driverId,
      branchId: v.branchId,
      date: iso(now - rng.float(0.2, 75) * DAY),
      type: rng.weighted([['pre_trip', 6], ['post_trip', 2], ['periodic', 2], ['roadworthiness', 1]] as const),
      result,
      odometerKm: v.odometerKm - rng.int(0, 6000),
      checklist,
      defects: checklist.filter((c) => !c.ok).map((c) => `${c.item}: ${c.note}`),
      inspector: v.driverId ? 'Driver self-check' : rng.pick(techs),
    })
  }
  inspections.sort((a, b) => b.date.localeCompare(a.date))
  return { providers: PROVIDERS, workOrders, schedules, inspections }
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------
export function buildSafety(now: number, fleet: FleetSeed, trips: Trip[]): { safetyEvents: SafetyEvent[]; incidents: Incident[] } {
  const rng = createRng(555)
  const iso = (t: number) => new Date(t).toISOString()
  const driverById = new Map(fleet.drivers.map((d) => [d.id, d]))
  const vehicleById = new Map(fleet.vehicles.map((v) => [v.id, v]))
  const completed = trips.filter((t) => t.status === 'completed' && t.vehicleId && t.driverId && t.actualStart && t.actualEnd)

  const posOnTrip = (t: Trip, frac: number) => {
    const route = ROUTE_BY_ID[t.routeId]!
    const d = t.routeDir === 1 ? frac * route.lengthM : (1 - frac) * route.lengthM
    const p = pointAt(route, d, t.routeDir)
    return { lat: p.lat, lng: p.lng, location: describeLocation(p, route.kind === 'highway' ? route.road.split(' ')[0] : undefined) }
  }

  const safetyEvents: SafetyEvent[] = []
  let n = 1
  const evtTypes: [SafetyEventType, number][] = [['harsh_braking', 30], ['speeding', 28], ['harsh_acceleration', 18], ['harsh_cornering', 8], ['idling', 6], ['fatigue', 4], ['seatbelt', 4], ['phone_use', 2]]
  for (const t of completed) {
    const d = driverById.get(t.driverId!)!
    const v = vehicleById.get(t.vehicleId!)!
    const expected = Math.max(0, (100 - d.safetyScore) / 22) * (t.plannedDistanceKm > 100 ? 0.7 : 0.35)
    let count = Math.floor(expected) + (rng.chance(expected - Math.floor(expected)) ? 1 : 0)
    count = Math.min(count, 4)
    for (let k = 0; k < count; k++) {
      const frac = rng.float(0.08, 0.95)
      const ts = new Date(t.actualStart!).getTime() + frac * (t.actualDurationMin ?? 120) * MIN
      const type = rng.weighted(evtTypes)
      const pos = posOnTrip(t, frac)
      const hwy = ROUTE_BY_ID[t.routeId]!.kind === 'highway'
      const limit = hwy ? (['heavy_truck', 'tanker', 'bus'].includes(v.category) ? 80 : 100) : 60
      const speed = type === 'speeding' ? limit + rng.int(8, 32) : type === 'idling' ? 0 : rng.int(hwy ? 55 : 25, hwy ? 95 : 55)
      safetyEvents.push({
        id: `sev-${String(n++).padStart(4, '0')}`,
        type,
        severity: type === 'fatigue' || type === 'phone_use' || (type === 'speeding' && speed - limit > 22) ? 'high' : rng.chance(0.4) ? 'medium' : 'low',
        vehicleId: v.id,
        driverId: d.id,
        branchId: v.branchId,
        tripId: t.id,
        timestamp: iso(ts),
        location: pos.location,
        lat: pos.lat,
        lng: pos.lng,
        speedKph: speed,
        limitKph: type === 'speeding' ? limit : undefined,
        value: type === 'harsh_braking' || type === 'harsh_acceleration' || type === 'harsh_cornering' ? Math.round(rng.float(0.32, 0.72) * 100) / 100 : type === 'fatigue' ? Math.round(rng.float(4.5, 7.5) * 10) / 10 : undefined,
        reviewed: ts < now - 7 * DAY ? rng.chance(0.85) : rng.chance(0.2),
      })
    }
  }
  safetyEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  safetyEvents.forEach((e, i) => (e.id = `sev-${String(i + 1).padStart(4, '0')}`))

  // incidents
  const types: [IncidentType, number][] = [['breakdown', 9], ['collision', 6], ['near_miss', 6], ['cargo_damage', 4], ['theft', 2], ['injury', 2], ['rollover', 1], ['fire', 1], ['other', 3]]
  const sev: Record<IncidentType, Incident['severity'][]> = {
    breakdown: ['minor', 'minor', 'moderate'], collision: ['minor', 'moderate', 'major'], near_miss: ['minor'], cargo_damage: ['minor', 'moderate'], theft: ['moderate', 'major'],
    injury: ['moderate', 'major'], rollover: ['critical'], fire: ['major', 'critical'], hijack: ['critical'], other: ['minor'],
  }
  const desc: Record<IncidentType, string[]> = {
    breakdown: ['Vehicle broke down on the highway due to mechanical failure; recovery arranged.', 'Overheating engine – vehicle stopped at roadside and towed to depot.'],
    collision: ['Rear-end collision at an intersection in heavy traffic; no injuries.', 'Side-swipe with a commuter omnibus while overtaking on a narrow road.', 'Collision with livestock on the highway at dusk.'],
    near_miss: ['Driver avoided a head-on collision after an oncoming vehicle overtook on a blind rise.', 'Pedestrian crossed unexpectedly; harsh braking prevented contact.'],
    cargo_damage: ['Load shifted during braking, causing damage to cartons.', 'Tarpaulin tore in strong winds; cargo exposed to rain.'],
    theft: ['Diesel siphoned from fuel tank while the vehicle was parked overnight.', 'Spare wheel and tools stolen from truck during rest stop.'],
    injury: ['Driver sustained minor injury while loading; first aid administered.', 'Loader injured hand during offloading at customer premises.'],
    rollover: ['Vehicle rolled over on a wet curve; driver taken to hospital for observation.'],
    fire: ['Electrical fire in engine bay; extinguished by driver using onboard extinguisher.'],
    hijack: ['Attempted hijack reported; driver unharmed.'],
    other: ['Vehicle impounded at roadblock pending documentation check.', 'Damage to depot gate while reversing.'],
  }
  const incidents: Incident[] = []
  const pickTrips = rng.shuffle(completed).slice(0, 40)
  for (let i = 0; i < 34; i++) {
    const t = pickTrips[i]!
    const type = rng.weighted(types)
    const frac = rng.float(0.1, 0.9)
    const ts = new Date(t.actualStart!).getTime() + frac * (t.actualDurationMin ?? 120) * MIN
    const pos = posOnTrip(t, frac)
    const severity = rng.pick(sev[type])
    const age = (now - ts) / DAY
    incidents.push({
      id: `inc-${String(i + 1).padStart(4, '0')}`,
      ref: '',
      type,
      severity,
      status: age > 45 ? rng.weighted([['closed', 5], ['resolved', 2]] as const) : age > 14 ? rng.weighted([['resolved', 4], ['investigating', 3], ['closed', 2]] as const) : rng.weighted([['reported', 3], ['investigating', 4]] as const),
      vehicleId: t.vehicleId!,
      driverId: t.driverId,
      tripId: t.id,
      branchId: t.branchId,
      date: iso(ts),
      location: pos.location,
      lat: pos.lat,
      lng: pos.lng,
      description: rng.pick(desc[type]),
      injuries: type === 'injury' ? rng.int(1, 2) : type === 'rollover' ? 1 : type === 'collision' && severity === 'major' ? rng.int(0, 2) : 0,
      thirdPartyInvolved: type === 'collision' || type === 'near_miss' || type === 'theft',
      policeReportNo: ['collision', 'theft', 'rollover', 'injury', 'hijack'].includes(type) ? `ZRP/${rng.int(100, 999)}/${rng.int(24, 26)}` : undefined,
      estCostUsd: Math.round({ minor: rng.float(60, 600), moderate: rng.float(500, 4500), major: rng.float(3500, 18000), critical: rng.float(12000, 60000) }[severity] / 10) * 10,
      insuranceClaim: severity === 'major' || severity === 'critical' || (type === 'collision' && rng.chance(0.5)),
      reportedBy: driverById.get(t.driverId!)?.name ?? 'Dispatcher',
      rootCause: age > 14 ? rng.pick(['Driver fatigue', 'Mechanical failure', 'Poor road conditions', 'Following distance too short', 'Inadequate load securing', 'External third-party fault']) : undefined,
      actionsTaken: age > 14 ? rng.pick(['Driver coaching completed', 'Vehicle repaired and re-inspected', 'Insurance claim lodged', 'Route risk assessment updated']) : undefined,
    })
  }
  incidents.sort((a, b) => a.date.localeCompare(b.date))
  incidents.forEach((x, i) => {
    x.id = `inc-${String(i + 1).padStart(4, '0')}`
    x.ref = `INC-${new Date(x.date).getFullYear()}-${String(i + 1).padStart(3, '0')}`
  })
  return { safetyEvents, incidents }
}

// ---------------------------------------------------------------------------
// Telematics daily summary
// ---------------------------------------------------------------------------
export function buildDaily(now: number, fleet: FleetSeed, trips: Trip[], fuel: FuelTransaction[]): DailyStat[] {
  const rng = createRng(2468)
  const dayKey = (t: number | string) => new Date(t).toISOString().slice(0, 10)
  const usedByDay = new Map<string, Set<string>>()
  const kmByDay = new Map<string, number>()
  for (const t of trips) {
    if (t.status !== 'completed' || !t.vehicleId) continue
    const k = dayKey(t.actualStart!)
    ;(usedByDay.get(k) ?? usedByDay.set(k, new Set()).get(k)!).add(t.vehicleId)
    kmByDay.set(k, (kmByDay.get(k) ?? 0) + (t.actualDistanceKm ?? 0))
  }
  const fuelByDay = new Map<string, number>()
  for (const f of fuel) fuelByDay.set(dayKey(f.date), (fuelByDay.get(dayKey(f.date)) ?? 0) + f.litres)
  const baseInService = fleet.vehicles.filter((v) => v.status === 'active').length
  const out: DailyStat[] = []
  let drift = 0
  for (let i = 119; i >= 1; i--) {
    const d = new Date(now - i * DAY)
    const key = dayKey(d.getTime())
    const dow = d.getUTCDay()
    const weekend = dow === 0 ? 0.45 : dow === 6 ? 0.72 : 1
    drift = Math.max(-3, Math.min(3, drift + rng.int(-1, 1)))
    const inService = baseInService + drift
    const trip = usedByDay.get(key)?.size ?? 0
    const active = Math.min(inService, Math.round((trip + rng.int(9, 15)) * weekend * rng.float(0.96, 1.08)))
    const hours = rng.float(5.2, 7.4) * weekend
    out.push({
      id: key,
      date: key,
      inService,
      activeVehicles: active,
      utilisationPct: Math.round((active / inService) * 1000) / 10,
      drivingHours: Math.round(active * hours * 10) / 10,
      idleHours: Math.round(active * rng.float(0.9, 1.9) * 10) / 10,
      distanceKm: Math.round((kmByDay.get(key) ?? 0) + active * rng.float(25, 55)),
      fuelL: Math.round(fuelByDay.get(key) ?? 0),
    })
  }
  return out
}
