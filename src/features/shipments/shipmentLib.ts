import type { CargoType, Invoice, Place, Shipment, ShipmentMilestone, ShipmentStatus, Trip, VehicleCategory } from '@/types'
import { ROUTES, routeEndpoints, type Route } from '@/data/routes'
import { PLACES } from '@/data/places'
import { haversineM } from '@/lib/geo'
import { fmtNumber } from '@/lib/format'
import { CARGO_TYPE } from '@/config/status'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export const STAGES = ['registered', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = {
  registered: 'Shipment registered',
  allocated: 'Vehicle & driver allocated',
  picked_up: 'Picked up from origin',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
}

/** Short step labels used on the stepper & buttons. */
export const STAGE_SHORT: Record<Stage, string> = {
  registered: 'Registered',
  allocated: 'Allocated',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
}

export const stageIndex = (k: string) => STAGES.indexOf(k as Stage)

export const isOpenException = (s: Shipment) => !!s.exception && !s.exception.resolved

/** Furthest lifecycle stage reached, ignoring the exception overlay. */
export function reachedStage(s: Shipment): Stage {
  let idx = 0
  for (const m of s.milestones) {
    const i = stageIndex(m.key)
    if (i >= 0 && m.at) idx = Math.max(idx, i)
  }
  if (s.status !== 'exception') idx = Math.max(idx, stageIndex(s.status))
  return STAGES[idx]!
}

export const reachedIndex = (s: Shipment) => stageIndex(reachedStage(s))

/** The six lifecycle milestones in order (missing ones are synthesised as pending). */
export function stageMilestones(s: Pick<Shipment, 'milestones'>): ShipmentMilestone[] {
  return STAGES.map((k) => s.milestones.find((m) => m.key === k) ?? { key: k, label: STAGE_LABEL[k], at: null })
}

export const exceptionMilestones = (s: Pick<Shipment, 'milestones'>) => s.milestones.filter((m) => m.key === 'exception')

export function blankMilestones(registeredAt: string): ShipmentMilestone[] {
  return STAGES.map((k) => ({ key: k, label: STAGE_LABEL[k], at: k === 'registered' ? registeredAt : null }))
}

/**
 * Advance the lifecycle to `to`: stamps the target milestone (plus any skipped ones) with `at`,
 * keeps exception milestones untouched and returns the full milestone list.
 */
export function advanceMilestones(s: Shipment, to: Stage, at: string, note?: string): ShipmentMilestone[] {
  const toIdx = stageIndex(to)
  const stages = stageMilestones(s).map((m, i) => {
    if (i > toIdx) return m
    if (i === toIdx) return { ...m, at: m.at ?? at, note: note?.trim() ? note.trim() : m.note }
    return m.at ? m : { ...m, at }
  })
  return [...stages, ...exceptionMilestones(s)]
}

/** Latest timestamp already on the shipment's lifecycle — a new milestone can't pre-date it. */
export function lastMilestoneAt(s: Shipment): string {
  let t = new Date(s.createdAt).getTime()
  for (const m of s.milestones) if (m.at) t = Math.max(t, new Date(m.at).getTime())
  return new Date(t).toISOString()
}

export function nextStage(s: Shipment): Stage | null {
  if (s.status === 'delivered') return null
  const i = reachedIndex(s)
  return STAGES[i + 1] ?? null
}

export const canAllocate = (s: Shipment) => s.status !== 'delivered' && s.status !== 'exception' && reachedIndex(s) <= 1
export const canUpdateStatus = (s: Shipment) => s.status !== 'delivered' && s.status !== 'exception' && reachedIndex(s) >= 1 && reachedIndex(s) < 4
export const canCapturePod = (s: Shipment) => s.status !== 'delivered' && s.status !== 'exception' && reachedIndex(s) >= 1
export const canRaiseException = (s: Shipment) => s.status !== 'delivered' && s.status !== 'exception'

export const EXCEPTION_TYPES = [
  'Damaged goods',
  'Short delivery',
  'Customer unavailable',
  'Border documentation hold',
  'Delivery address query',
  'Vehicle breakdown',
  'Road closure / weather',
  'Cargo security concern',
  'Other',
]

export const SHIPMENT_STATUSES: ShipmentStatus[] = ['registered', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception']

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function fmtWeight(kg: number | null | undefined) {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return '—'
  return kg >= 1000 ? `${fmtNumber(kg / 1000, 1)} t` : `${fmtNumber(kg)} kg`
}

export const cargoLabel = (t: CargoType) => CARGO_TYPE[t] ?? t

export const etaOf = (s: Shipment) => s.deliveredAt ?? s.deliveryEta

export const isOverdue = (s: Shipment, now = Date.now()) => s.status !== 'delivered' && new Date(s.deliveryEta).getTime() < now

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------
export const CITY_OPTIONS = PLACES.filter((p) => p.kind === 'city' || p.kind === 'town').map((p) => ({ value: p.name, label: p.name }))

export function cityCoords(city: string): { lat: number; lng: number } {
  const p = PLACES.find((x) => x.name.toLowerCase() === city.toLowerCase())
  return p ? { lat: p.lat, lng: p.lng } : { lat: -17.8292, lng: 31.0522 }
}

// ---------------------------------------------------------------------------
// Routes / trips
// ---------------------------------------------------------------------------
export const AVG_SPEED: Record<VehicleCategory, number> = {
  heavy_truck: 62, tanker: 60, refrigerated: 68, bus: 72, light_truck: 74, delivery_van: 80, pickup: 84, service: 80, motorcycle: 55,
}

export function estimateDurationMin(route: Route, cat: VehicleCategory) {
  return Math.round(route.kind === 'highway' ? (route.lengthM / 1000 / AVG_SPEED[cat]) * 60 + 25 : (route.lengthM / 1000 / 24) * 60 + 35)
}

/** Direction of travel (+1 first→last coordinate) that starts nearest to the pickup point. */
export function routeDirFor(route: Route, pickup: { lat: number; lng: number }): 1 | -1 {
  const a = routeEndpoints(route, 1)
  const b = routeEndpoints(route, -1)
  return haversineM(pickup, a.from) <= haversineM(pickup, b.from) ? 1 : -1
}

/** Best matching predefined road route for a pickup → delivery pair (both directions are considered). */
export function suggestRoute(pickup: Place, delivery: Place): { route: Route; dir: 1 | -1; km: number } | null {
  let best: { route: Route; dir: 1 | -1; km: number } | null = null
  for (const route of ROUTES) {
    for (const dir of [1, -1] as const) {
      const ep = routeEndpoints(route, dir)
      const km = (haversineM(pickup, ep.from) + haversineM(delivery, ep.to)) / 1000
      if (!best || km < best.km) best = { route, dir, km }
    }
  }
  return best
}

export function nextTripRef(trips: Trip[]) {
  let max = 10240
  for (const t of trips) {
    const m = /(\d+)$/.exec(t.ref)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `TRP-${new Date().getFullYear()}-${String(max + 1).padStart(5, '0')}`
}

export function newTrackingRef(existing: Shipment[]) {
  const used = new Set(existing.map((s) => s.trackingRef))
  for (let i = 0; i < 50; i++) {
    const ref = `ZFL-${Math.floor(1000000 + Math.random() * 9000000)}`
    if (!used.has(ref)) return ref
  }
  return `ZFL-${Date.now().toString().slice(-7)}`
}

// ---------------------------------------------------------------------------
// Finance helpers
// ---------------------------------------------------------------------------
export const OPEN_INVOICE_STATUSES: Invoice['status'][] = ['sent', 'partial', 'overdue']
export const invoiceBalance = (i: Invoice) => (OPEN_INVOICE_STATUSES.includes(i.status) ? Math.max(0, i.amountUsd - i.paidUsd) : 0)
