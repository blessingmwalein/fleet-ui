import type { Branch, DocumentRecord, Driver, FuelCard, FuelType, Vehicle, VehicleCategory } from '@/types'
import { createRng, type Rng } from '@/lib/rng'
import { COLOURS, FIRST_NAMES_F, FIRST_NAMES_M, SURNAMES } from './names'
import { BRANCH_SEEDS } from './org'

export type VehiclePlan = 'moving' | 'idle' | 'stopped' | 'maintenance' | 'offline_route' | 'offline_parked' | 'out_of_service'

export interface VehicleSeedRow {
  branch: string
  cat: VehicleCategory
  plan: VehiclePlan
  route?: string
  dir?: 1 | -1
  progress?: number
  delayed?: boolean
  noDriver?: boolean
}

const r = (
  branch: string,
  cat: VehicleCategory,
  plan: VehiclePlan,
  route?: string,
  dir: 1 | -1 = 1,
  extra: Partial<VehicleSeedRow> = {},
): VehicleSeedRow => ({ branch, cat, plan, route, dir, ...extra })

export const VEHICLE_PLAN: VehicleSeedRow[] = [
  r('HRE', 'heavy_truck', 'moving', 'R-HRE-BYO', 1),
  r('HRE', 'heavy_truck', 'moving', 'R-HRE-MUT', 1, { delayed: true }),
  r('HRE', 'refrigerated', 'moving', 'R-HRE-BYO', 1),
  r('HRE', 'delivery_van', 'moving', 'R-HRE-C1', 1),
  r('HRE', 'delivery_van', 'moving', 'R-HRE-C4', -1),
  r('HRE', 'light_truck', 'moving', 'R-HRE-C5', 1, { progress: 0.93 }),
  r('HRE', 'pickup', 'idle'),
  r('HRE', 'bus', 'moving', 'R-HRE-CHI', 1),
  r('HRE', 'delivery_van', 'stopped'),
  r('HSD', 'heavy_truck', 'moving', 'R-HRE-MSV', 1),
  r('HSD', 'tanker', 'moving', 'R-HRE-KWE', 1),
  r('HSD', 'light_truck', 'moving', 'R-HRE-C2', 1, { delayed: true }),
  r('HSD', 'delivery_van', 'moving', 'R-HRE-C3', -1),
  r('HSD', 'pickup', 'maintenance', undefined, 1, { noDriver: true }),
  r('HSD', 'refrigerated', 'idle'),
  r('BYO', 'heavy_truck', 'moving', 'R-BYO-BBR', 1),
  r('BYO', 'heavy_truck', 'moving', 'R-HRE-BYO', -1),
  r('BYO', 'tanker', 'moving', 'R-BYO-GWE', 1, { progress: 0.94 }),
  r('BYO', 'delivery_van', 'moving', 'R-BYO-C1', 1),
  r('BYO', 'light_truck', 'moving', 'R-BYO-C2', -1),
  r('BYO', 'bus', 'offline_route', 'R-BYO-GWE', -1),
  r('BYO', 'pickup', 'idle'),
  r('BYO', 'refrigerated', 'moving', 'R-BYO-GWE', -1),
  r('MUT', 'heavy_truck', 'moving', 'R-HRE-MUT', -1),
  r('MUT', 'delivery_van', 'moving', 'R-MUT-C1', 1),
  r('MUT', 'bus', 'maintenance', undefined, 1, { noDriver: true }),
  r('MUT', 'pickup', 'offline_parked'),
  r('GWE', 'heavy_truck', 'moving', 'R-GWE-MSV', 1, { delayed: true }),
  r('GWE', 'light_truck', 'moving', 'R-GWE-C1', -1),
  r('GWE', 'tanker', 'moving', 'R-KWE-GWE', 1),
  r('GWE', 'delivery_van', 'idle'),
  r('KWE', 'heavy_truck', 'moving', 'R-HRE-KWE', -1),
  r('KWE', 'tanker', 'out_of_service', undefined, 1, { noDriver: true }),
  r('KWE', 'pickup', 'stopped'),
  r('MSV', 'heavy_truck', 'moving', 'R-MSV-BBR', 1),
  r('MSV', 'light_truck', 'moving', 'R-MSV-C1', 1),
  r('MSV', 'bus', 'moving', 'R-HRE-MSV', -1),
  r('MSV', 'refrigerated', 'offline_route', 'R-GWE-MSV', -1),
  r('CHI', 'light_truck', 'moving', 'R-HRE-CHI', -1, { progress: 0.92 }),
  r('CHI', 'pickup', 'idle'),
  r('CHI', 'delivery_van', 'out_of_service', undefined, 1, { noDriver: true }),
  r('BBR', 'heavy_truck', 'moving', 'R-MSV-BBR', -1),
  r('BBR', 'heavy_truck', 'moving', 'R-BYO-BBR', -1, { delayed: true }),
  r('BBR', 'tanker', 'moving', 'R-BBR-C1', 1),
  r('BBR', 'light_truck', 'stopped'),
  r('BBR', 'pickup', 'maintenance', undefined, 1, { noDriver: true }),
  r('WKS', 'service', 'maintenance', undefined, 1, { noDriver: true }),
  r('WKS', 'service', 'moving', 'R-HRE-C3', 1),
  r('WKS', 'service', 'idle'),
  r('WKS', 'service', 'maintenance', undefined, 1, { noDriver: true }),
  // courier motorbikes (appended so existing vehicle ids stay stable)
  r('HRE', 'motorcycle', 'moving', 'R-HRE-C1', -1),
  r('HRE', 'motorcycle', 'moving', 'R-HRE-C5', 1),
  r('BYO', 'motorcycle', 'moving', 'R-BYO-C2', 1),
  r('GWE', 'motorcycle', 'idle'),
]

interface CatSpec {
  models: { make: string; model: string }[]
  tank: [number, number]
  load: [number, number]
  axles: [number, number]
  seats?: [number, number]
  cost: [number, number]
  odo: [number, number]
  fuel: FuelType
}

const CAT: Record<VehicleCategory, CatSpec> = {
  heavy_truck: {
    models: [
      { make: 'Scania', model: 'R 450 6x4' }, { make: 'Volvo', model: 'FH 460 6x4' }, { make: 'Mercedes-Benz', model: 'Actros 2645' },
      { make: 'MAN', model: 'TGS 26.440' }, { make: 'Isuzu', model: 'FXZ 1400' }, { make: 'Hino', model: '700 SH 2848' },
    ],
    tank: [500, 700], load: [28000, 34000], axles: [3, 6], cost: [135000, 205000], odo: [180000, 640000], fuel: 'diesel',
  },
  light_truck: {
    models: [{ make: 'Isuzu', model: 'NPR 400' }, { make: 'Hino', model: '300 815' }, { make: 'Mitsubishi Fuso', model: 'Canter FE85' }, { make: 'Isuzu', model: 'NQR 500' }],
    tank: [100, 140], load: [4500, 8000], axles: [2, 2], cost: [42000, 68000], odo: [70000, 260000], fuel: 'diesel',
  },
  delivery_van: {
    models: [{ make: 'Toyota', model: 'Hiace Panel Van' }, { make: 'Nissan', model: 'NV350 Urvan' }, { make: 'Mercedes-Benz', model: 'Sprinter 314' }, { make: 'Ford', model: 'Transit 2.2 TDCi' }],
    tank: [70, 80], load: [1000, 1400], axles: [2, 2], cost: [28000, 42000], odo: [45000, 190000], fuel: 'diesel',
  },
  pickup: {
    models: [{ make: 'Toyota', model: 'Hilux 2.8 GD-6' }, { make: 'Ford', model: 'Ranger 3.2 XLT' }, { make: 'Isuzu', model: 'D-Max 3.0 LS' }, { make: 'Nissan', model: 'Navara 2.3 dCi' }],
    tank: [75, 80], load: [900, 1200], axles: [2, 2], seats: [5, 5], cost: [32000, 49000], odo: [30000, 220000], fuel: 'diesel',
  },
  bus: {
    models: [{ make: 'Yutong', model: 'ZK6122H9' }, { make: 'Marcopolo', model: 'Paradiso 1200' }, { make: 'Scania', model: 'K360 Irizar' }, { make: 'Mercedes-Benz', model: 'O500 RS' }],
    tank: [320, 420], load: [5000, 7500], axles: [2, 3], seats: [49, 65], cost: [120000, 230000], odo: [210000, 700000], fuel: 'diesel',
  },
  tanker: {
    models: [{ make: 'Scania', model: 'P 410 Fuel Tanker' }, { make: 'Volvo', model: 'FM 440 Fuel Tanker' }, { make: 'Mercedes-Benz', model: 'Actros 2644 Tanker' }, { make: 'Hino', model: '500 FM Tanker' }],
    tank: [450, 600], load: [26000, 33000], axles: [3, 5], cost: [120000, 185000], odo: [150000, 540000], fuel: 'diesel',
  },
  refrigerated: {
    models: [{ make: 'Hino', model: '500 FC Reefer' }, { make: 'Isuzu', model: 'FTR 850 Reefer' }, { make: 'Mercedes-Benz', model: 'Atego 1523 Reefer' }, { make: 'Mitsubishi Fuso', model: 'Canter FE Reefer' }],
    tank: [180, 260], load: [7000, 12000], axles: [2, 3], cost: [72000, 112000], odo: [80000, 390000], fuel: 'diesel',
  },
  motorcycle: {
    models: [{ make: 'Honda', model: 'CG 125 Courier' }, { make: 'Yamaha', model: 'YBR 125' }, { make: 'Suzuki', model: 'GN 125' }, { make: 'Honda', model: 'CB 150 Courier' }],
    tank: [11, 15], load: [30, 80], axles: [2, 2], seats: [2, 2], cost: [1800, 3500], odo: [8000, 70000], fuel: 'petrol',
  },
  service: {
    models: [{ make: 'Toyota', model: 'Land Cruiser 79 Service' }, { make: 'Toyota', model: 'Hilux Service Body' }, { make: 'Isuzu', model: 'NPR Service Truck' }],
    tank: [85, 130], load: [1200, 3000], axles: [2, 2], seats: [2, 5], cost: [38000, 62000], odo: [40000, 150000], fuel: 'diesel',
  },
}

export function regNumber(rng: Rng, used: Set<string>) {
  for (;;) {
    const l = () => String.fromCharCode(65 + rng.int(0, 5))
    const l2 = () => String.fromCharCode(65 + rng.int(0, 25))
    const reg = `A${l()}${l2()} ${rng.int(1000, 9899)}`
    if (!used.has(reg)) {
      used.add(reg)
      return reg
    }
  }
}

const rnd = (rng: Rng, [a, b]: [number, number]) => rng.int(a, b)

export interface FleetSeed {
  vehicles: Vehicle[]
  drivers: Driver[]
  documents: DocumentRecord[]
  fuelCards: FuelCard[]
  /** vehicleId -> plan row (used by trip seeding only) */
  plans: Map<string, VehicleSeedRow>
}

export function buildFleet(now: number): FleetSeed {
  const rng = createRng(20260101)
  const day = 864e5
  const iso = (t: number) => new Date(t).toISOString()
  const used = new Set<string>()
  const branchByCode = new Map<string, Branch>(BRANCH_SEEDS.map((b) => [b.code, b]))
  const plans = new Map<string, VehicleSeedRow>()

  const vehicles: Vehicle[] = VEHICLE_PLAN.map((row, i) => {
    const spec = CAT[row.cat]
    const m = rng.pick(spec.models)
    const branch = branchByCode.get(row.branch)!
    const year = rng.int(2016, 2025)
    const age = 2026 - year
    const id = `veh-${String(i + 1).padStart(3, '0')}`
    const odo = Math.round(Math.min(spec.odo[1], spec.odo[0] + (spec.odo[1] - spec.odo[0]) * Math.min(1, (age + rng.float(0, 2)) / 9)) / 10) * 10
    const status = row.plan === 'maintenance' ? 'maintenance' : row.plan === 'out_of_service' ? 'out_of_service' : 'active'
    plans.set(id, row)
    return {
      id,
      reg: regNumber(rng, used),
      make: m.make,
      model: m.model,
      year,
      category: row.cat,
      vin: `AHT${rng.int(10000000, 99999999)}${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(1000, 9999)}`.slice(0, 17).padEnd(17, '0'),
      engineNo: `${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(100000, 999999)}`,
      colour: row.cat === 'refrigerated' || row.cat === 'tanker' ? 'White' : rng.pick(COLOURS),
      fuelType: spec.fuel,
      tankCapacityL: rnd(rng, spec.tank),
      loadCapacityKg: Math.round(rnd(rng, spec.load) / 100) * 100,
      seats: spec.seats ? rnd(rng, spec.seats) : undefined,
      axles: rnd(rng, spec.axles),
      branchId: branch.id,
      driverId: null,
      status,
      odometerKm: odo,
      fuelPct: row.plan === 'maintenance' ? rng.int(10, 40) : rng.int(35, 96),
      purchaseDate: iso(now - (age * 365 + rng.int(0, 300)) * day),
      purchaseCostUsd: Math.round(rnd(rng, spec.cost) / 500) * 500,
      deviceId: `GPS-${rng.int(100000, 999999)}`,
      homeLat: branch.lat + rng.float(-0.0018, 0.0018),
      homeLng: branch.lng + rng.float(-0.0018, 0.0018),
      createdAt: iso(now - (age * 365 + 30) * day),
    }
  })

  // ---- drivers ---------------------------------------------------------
  const nameSet = new Set<string>()
  const driverCount = 50
  const drivers: Driver[] = []
  const assignable = vehicles.filter((v) => !plans.get(v.id)!.noDriver)
  for (let i = 0; i < driverCount; i++) {
    let name = ''
    let female = false
    do {
      female = rng.chance(0.13)
      name = `${rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M)} ${rng.pick(SURNAMES)}`
    } while (nameSet.has(name))
    nameSet.add(name)
    const v = assignable[i]
    const branchId = v ? v.branchId : rng.pick(BRANCH_SEEDS).id
    const cat = v?.category ?? 'delivery_van'
    const heavy = ['heavy_truck', 'tanker', 'refrigerated', 'bus'].includes(cat)
    const born = now - rng.int(26, 58) * 365 * day
    const expiryBucket = rng.next()
    const licenceExpiry =
      expiryBucket < 0.06 ? now - rng.int(5, 60) * day : expiryBucket < 0.16 ? now + rng.int(3, 28) * day : expiryBucket < 0.26 ? now + rng.int(30, 75) * day : now + rng.int(100, 1500) * day
    const id = `drv-${String(i + 1).padStart(3, '0')}`
    const surnameLower = name.split(' ')[1]!.toLowerCase()
    const scoreBase = rng.gauss(82, 9)
    const status: Driver['status'] = !v ? (i === driverCount - 1 ? 'suspended' : 'on_leave') : ['idle', 'stopped'].includes(plans.get(v.id)!.plan) && rng.chance(0.3) ? 'off_duty' : 'active'
    drivers.push({
      id,
      name,
      empNo: `ZFL-${1100 + i * 7}`,
      phone: `+263 7${rng.pick([1, 7, 8])} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      email: `${name.split(' ')[0]!.toLowerCase()}.${surnameLower}@zambezifreight.co.zw`,
      nationalId: `${rng.int(10, 79)}-${rng.int(100000, 999999)} ${String.fromCharCode(65 + rng.int(0, 25))} ${rng.int(10, 99)}`,
      dob: iso(born),
      gender: female ? 'female' : 'male',
      address: `${rng.int(1, 240)} ${rng.pick(['Chiremba', 'Mazowe', 'Nelson Mandela', 'Josiah Tongogara', 'Herbert Chitepo', 'Jason Moyo'])} ${rng.pick(['Rd', 'St', 'Ave'])}, ${branchByIdCity(branchId)}`,
      licenceNo: `${rng.int(100000, 999999)}${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}`,
      licenceClass: heavy ? rng.pick(['Class 1', 'Class 1', 'Class 2']) : cat === 'light_truck' ? 'Class 2' : 'Class 4',
      licenceExpiry: iso(licenceExpiry),
      defensiveDrivingExpiry: iso(now + rng.int(-20, 540) * day),
      medicalExpiry: iso(now + rng.int(-10, 420) * day),
      hireDate: iso(now - rng.int(200, 3800) * day),
      branchId,
      vehicleId: v?.id ?? null,
      status,
      safetyScore: Math.max(48, Math.min(99, Math.round(scoreBase))),
      emergencyContact: `${rng.pick(FIRST_NAMES_F)} ${name.split(' ')[1]}`,
      emergencyPhone: `+263 77 ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      employmentType: rng.weighted([['permanent', 8], ['contract', 3], ['casual', 1]] as const),
      salaryUsd: heavy ? rng.int(520, 780) : rng.int(380, 560),
    })
    if (v) v.driverId = id
  }

  // ---- documents -------------------------------------------------------
  const documents: DocumentRecord[] = []
  let docN = 1
  const expiryFrom = () => {
    const x = rng.next()
    if (x < 0.06) return now - rng.int(1, 40) * day
    if (x < 0.18) return now + rng.int(1, 29) * day
    if (x < 0.3) return now + rng.int(30, 60) * day
    return now + rng.int(75, 420) * day
  }
  const pushDoc = (entityType: 'vehicle' | 'driver', entityId: string, type: DocumentRecord['type'], issuer: string, prefix: string, expiry: number, uploadedBy = 'Fleet Admin') => {
    const issued = expiry - 365 * day
    documents.push({
      id: `doc-${String(docN++).padStart(4, '0')}`,
      entityType,
      entityId,
      type,
      number: `${prefix}-${rng.int(100000, 999999)}`,
      issuer,
      issueDate: iso(issued),
      expiryDate: iso(expiry),
      fileName: `${type}_${entityId}.pdf`,
      fileSizeKb: rng.int(120, 2400),
      uploadedAt: iso(issued + rng.int(0, 6) * day),
      uploadedBy,
    })
  }
  for (const v of vehicles) {
    pushDoc('vehicle', v.id, 'insurance', rng.pick(['Old Mutual Insurance', 'Zimnat General', 'Nyaradzo Motor Cover', 'First Mutual']), 'POL', expiryFrom())
    pushDoc('vehicle', v.id, 'roadworthiness', 'VID Zimbabwe', 'CRW', expiryFrom())
    pushDoc('vehicle', v.id, 'vehicle_licence', 'ZINARA', 'VL', expiryFrom())
    if (['heavy_truck', 'tanker', 'refrigerated', 'bus'].includes(v.category)) pushDoc('vehicle', v.id, 'route_permit', 'Ministry of Transport', 'RP', expiryFrom())
    else pushDoc('vehicle', v.id, 'carbon_tax', 'ZINARA', 'CT', expiryFrom())
  }
  for (const d of drivers) {
    pushDoc('driver', d.id, 'driver_licence', 'VID Zimbabwe', 'DL', new Date(d.licenceExpiry).getTime())
    pushDoc('driver', d.id, 'defensive_driving', 'TSCZ', 'DD', new Date(d.defensiveDrivingExpiry).getTime())
    pushDoc('driver', d.id, 'medical', 'Occupational Health Clinic', 'MED', new Date(d.medicalExpiry).getTime())
  }

  // ---- fuel cards ------------------------------------------------------
  const fuelCards: FuelCard[] = vehicles.map((v, i) => {
    const limit = ['heavy_truck', 'tanker', 'bus'].includes(v.category) ? 4500 : ['refrigerated', 'light_truck'].includes(v.category) ? 2200 : 900
    const expired = i % 23 === 7
    const blocked = i % 17 === 3
    return {
      id: `fc-${String(i + 1).padStart(3, '0')}`,
      number: `5412 •••• ${rng.int(1000, 9999)}`,
      vehicleId: v.id,
      provider: rng.pick(['Puma Energy FleetCard', 'Zuva FuelPass', 'TotalEnergies Fleet']),
      status: expired ? 'expired' : blocked ? 'blocked' : 'active',
      monthlyLimitUsd: limit,
      spentThisMonthUsd: Math.round(limit * rng.float(0.25, 0.95)),
      expiry: iso(now + (expired ? -rng.int(5, 40) : rng.int(90, 900)) * day),
      pinSetAt: iso(now - rng.int(30, 600) * day),
    }
  })
  // a few spare cards
  for (let i = 0; i < 3; i++) {
    fuelCards.push({
      id: `fc-${String(vehicles.length + i + 1).padStart(3, '0')}`,
      number: `5412 •••• ${rng.int(1000, 9999)}`,
      vehicleId: null,
      provider: 'Puma Energy FleetCard',
      status: 'unassigned',
      monthlyLimitUsd: 1500,
      spentThisMonthUsd: 0,
      expiry: iso(now + rng.int(200, 900) * day),
      pinSetAt: iso(now - rng.int(5, 90) * day),
    })
  }

  return { vehicles, drivers, documents, fuelCards, plans }
}

function branchByIdCity(id: string) {
  return BRANCH_SEEDS.find((b) => b.id === id)?.city ?? 'Harare'
}
