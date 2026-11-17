import { startOfDay } from 'date-fns'
import type {
  DocumentRecord, DocumentType, Expense, FuelTransaction, LiveState, ServiceSchedule, Telemetry, Trip, Vehicle, VehicleCategory, VehicleStatus, WorkOrder,
} from '@/types'
import { DOCUMENT_TYPE, expiryState, LIVE_STATE, VEHICLE_STATUS } from '@/config/status'

const DAY = 864e5

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */
export const REG_RE = /^[A-Z]{3} \d{4}$/

/** "acf4821" / "acf  4821" → "ACF 4821" */
export function normaliseReg(s: string): string {
  const t = s.trim().toUpperCase().replace(/\s+/g, ' ')
  const m = /^([A-Z]{3})\s?(\d{4})$/.exec(t)
  return m ? `${m[1]} ${m[2]}` : t
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */
/** Live state, extended with the administrative statuses that outrank GPS state. */
export type VehicleStatusKey = LiveState | VehicleStatus

export function statusKeyOf(v: Pick<Vehicle, 'status'>, live?: Telemetry): VehicleStatusKey {
  if (v.status === 'out_of_service') return 'out_of_service'
  if (v.status === 'maintenance') return 'maintenance'
  return live?.state ?? 'active'
}

export function statusLabel(key: string): string {
  if (key === 'active' || key === 'out_of_service') return VEHICLE_STATUS[key].label
  return LIVE_STATE[key as LiveState]?.label ?? key
}

export const STATUS_FACET_OPTIONS = (['moving', 'idle', 'stopped', 'maintenance', 'offline', 'out_of_service'] as const).map((value) => ({ value, label: statusLabel(value) }))

export const VEHICLE_CATEGORY_KEYS = ['heavy_truck', 'light_truck', 'delivery_van', 'pickup', 'bus', 'tanker', 'refrigerated', 'service', 'motorcycle'] as const satisfies readonly VehicleCategory[]
export const FUEL_TYPE_OPTIONS = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'petrol', label: 'Petrol' },
  { value: 'lpg', label: 'LPG' },
]

/** Heading in compass terms: 0 → N, 90 → E … */
export function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]!
}

/* ------------------------------------------------------------------ */
/* Service schedules                                                   */
/* ------------------------------------------------------------------ */
export type ScheduleState = 'overdue' | 'due_soon' | 'ok'

export function scheduleState(s: ServiceSchedule, odometerKm: number, now = Date.now()): ScheduleState {
  const dueTs = new Date(s.nextDueDate).getTime()
  if (dueTs < now || odometerKm >= s.nextDueKm) return 'overdue'
  if (dueTs - now <= 14 * DAY || s.nextDueKm - odometerKm <= 1000) return 'due_soon'
  return 'ok'
}

export interface ServiceInfo {
  schedule: ServiceSchedule | null
  dueTs: number | null
  state: ScheduleState | null
  overdue: boolean
  overdueCount: number
  daysLeft: number | null
  kmLeft: number | null
}

export function serviceInfo(schedules: ServiceSchedule[] | undefined, odometerKm: number, now = Date.now()): ServiceInfo {
  if (!schedules?.length) return { schedule: null, dueTs: null, state: null, overdue: false, overdueCount: 0, daysLeft: null, kmLeft: null }
  const decorated = schedules.map((s) => ({ s, state: scheduleState(s, odometerKm, now), ts: new Date(s.nextDueDate).getTime() }))
  decorated.sort((a, b) => Number(b.state === 'overdue') - Number(a.state === 'overdue') || a.ts - b.ts)
  const top = decorated[0]!
  return {
    schedule: top.s,
    dueTs: top.ts,
    state: top.state,
    overdue: top.state === 'overdue',
    overdueCount: decorated.filter((d) => d.state === 'overdue').length,
    daysLeft: Math.ceil((top.ts - now) / DAY),
    kmLeft: Math.round(top.s.nextDueKm - odometerKm),
  }
}

/* ------------------------------------------------------------------ */
/* Compliance documents                                                */
/* ------------------------------------------------------------------ */
export const VEHICLE_DOC_TYPES = ['insurance', 'roadworthiness', 'vehicle_licence', 'operator_licence', 'carbon_tax', 'route_permit', 'fitness_cert'] as const satisfies readonly DocumentType[]
export const VEHICLE_DOC_OPTIONS = VEHICLE_DOC_TYPES.map((value) => ({ value, label: DOCUMENT_TYPE[value] }))

const HEAVY: VehicleCategory[] = ['heavy_truck', 'tanker', 'refrigerated', 'bus']

export function requiredDocTypes(category: VehicleCategory): DocumentType[] {
  return HEAVY.includes(category) ? ['insurance', 'roadworthiness', 'vehicle_licence', 'route_permit'] : ['insurance', 'roadworthiness', 'vehicle_licence', 'carbon_tax']
}

export interface ComplianceItem {
  type: DocumentType
  label: string
  doc: DocumentRecord | null
  state: 'expired' | 'expiring' | 'valid' | 'missing'
  days: number
}

export function complianceOf(category: VehicleCategory, docs: DocumentRecord[], warnDays = 30, now = Date.now()) {
  const latest = new Map<DocumentType, DocumentRecord>()
  for (const d of docs) {
    const cur = latest.get(d.type)
    if (!cur || d.expiryDate > cur.expiryDate) latest.set(d.type, d)
  }
  const items: ComplianceItem[] = requiredDocTypes(category).map((type) => {
    const doc = latest.get(type) ?? null
    if (!doc) return { type, label: DOCUMENT_TYPE[type], doc, state: 'missing', days: 0 }
    const e = expiryState(doc.expiryDate, warnDays, now)
    return { type, label: DOCUMENT_TYPE[type], doc, state: e.state === 'unknown' ? 'missing' : e.state, days: e.days }
  })
  const count = (s: ComplianceItem['state']) => items.filter((i) => i.state === s).length
  return { items, expired: count('expired'), expiring: count('expiring'), missing: count('missing'), valid: count('valid'), total: items.length }
}

/* ------------------------------------------------------------------ */
/* Utilisation & operating cost                                        */
/* ------------------------------------------------------------------ */
/** Trip-hours per day over the last `days` days, and the share of days with meaningful activity. */
export function utilisationOf(trips: Trip[], now = Date.now(), days = 30) {
  const start0 = startOfDay(new Date(now - (days - 1) * DAY)).getTime()
  const hours = new Array<number>(days).fill(0)
  for (const t of trips) {
    if (t.status !== 'completed' && t.status !== 'in_transit' && t.status !== 'delayed') continue
    const s = new Date(t.actualStart ?? t.scheduledStart).getTime()
    const e = t.actualEnd ? new Date(t.actualEnd).getTime() : t.status === 'completed' ? new Date(t.plannedEnd).getTime() : now
    if (e < start0 || s > now) continue
    for (let d = 0; d < days; d++) {
      const a = start0 + d * DAY
      const overlap = Math.min(e, a + DAY) - Math.max(s, a)
      if (overlap > 0) hours[d]! += overlap / 36e5
    }
  }
  const activeDays = hours.filter((h) => h > 0.25).length
  return { pct: (activeDays / days) * 100, hours, activeDays, totalHours: hours.reduce((a, b) => a + b, 0) }
}

const inWindow = (iso: string | null | undefined, from: number, to: number) => {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= from && t <= to
}

export const woCost = (w: WorkOrder) => w.labourCostUsd + w.partsCostUsd
/** Expenses that are NOT already counted via fuel transactions / completed work orders. */
export const isOtherExpense = (e: Expense) => e.category !== 'fuel' && e.category !== 'maintenance' && e.status !== 'rejected'

export function operatingCost(src: { trips: Trip[]; fuel: FuelTransaction[]; workOrders: WorkOrder[]; expenses: Expense[] }, from: number, to: number) {
  const fuel = src.fuel.filter((f) => inWindow(f.date, from, to)).reduce((s, f) => s + f.totalUsd, 0)
  const maintenance = src.workOrders.filter((w) => w.status === 'completed' && inWindow(w.completedAt, from, to)).reduce((s, w) => s + woCost(w), 0)
  const other = src.expenses.filter((e) => isOtherExpense(e) && inWindow(e.date, from, to)).reduce((s, e) => s + e.amountUsd, 0)
  const km = src.trips.filter((t) => t.status === 'completed' && inWindow(t.actualEnd ?? t.plannedEnd, from, to)).reduce((s, t) => s + (t.actualDistanceKm ?? t.plannedDistanceKm), 0)
  const total = fuel + maintenance + other
  return { fuel, maintenance, other, total, km, perKm: km > 0 ? total / km : null }
}

/* ------------------------------------------------------------------ */
/* Fuel efficiency                                                     */
/* ------------------------------------------------------------------ */
export interface FillEfficiency {
  km: number
  l100: number
}

/** Tank-to-tank consumption using the odometer delta between consecutive fills (plausible values only). */
export function fuelEfficiency(sortedAsc: FuelTransaction[]): Map<string, FillEfficiency> {
  const out = new Map<string, FillEfficiency>()
  for (let i = 1; i < sortedAsc.length; i++) {
    const km = sortedAsc[i]!.odometerKm - sortedAsc[i - 1]!.odometerKm
    if (km < 15 || km > 3500) continue
    const l100 = (sortedAsc[i]!.litres / km) * 100
    if (l100 < 3 || l100 > 95) continue
    out.set(sortedAsc[i]!.id, { km, l100 })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function vehicleAgeYears(v: Vehicle, now = Date.now()): number {
  return Math.max(0, (now - new Date(v.purchaseDate).getTime()) / (365.25 * DAY))
}

/** Straight-line book value: 10-year life to 10% residual. */
export function bookValue(v: Vehicle, now = Date.now()): number {
  const age = vehicleAgeYears(v, now)
  const residual = v.purchaseCostUsd * 0.1
  return Math.max(residual, v.purchaseCostUsd - ((v.purchaseCostUsd - residual) * age) / 10)
}

export function fmtBytesKb(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
}
