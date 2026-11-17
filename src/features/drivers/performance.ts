import type { Driver, FuelTransaction, SafetyEvent, Trip, Vehicle } from '@/types'
import { bucketIndex, type Bucket } from '@/lib/analytics'
import { toDate } from '@/lib/format'
import { clamp } from '@/lib/utils'
import { ON_TIME_GRACE_MIN, tripDate, tripKm } from './driverData'

/* ----------------------------------------------------------------------------------------------
 * Pure analytics for the driver performance tab. Everything is derived from trips, safety events
 * and fuel transactions already in the database (nothing is hard-coded).
 * -------------------------------------------------------------------------------------------- */

type InRange = (v: string | number | Date | null | undefined) => boolean

export interface PerfContext {
  trips: Trip[]
  events: SafetyEvent[]
  /** litres fuelled per trip (sum of fuel transactions linked to the trip) */
  litresByTrip: Map<string, number>
  categoryByVehicle: Map<string, string>
  /** fleet-wide litres/100km per vehicle category (all history) — the fair fuel baseline */
  baseline: Record<string, number>
}

export function buildPerfContext(trips: Trip[], events: SafetyEvent[], fuel: FuelTransaction[], vehicles: Vehicle[]): PerfContext {
  const litresByTrip = new Map<string, number>()
  for (const f of fuel) if (f.tripId) litresByTrip.set(f.tripId, (litresByTrip.get(f.tripId) ?? 0) + f.litres)
  const categoryByVehicle = new Map(vehicles.map((v) => [v.id, v.category as string]))
  const sums: Record<string, { l: number; km: number }> = {}
  for (const t of trips) {
    if (t.status !== 'completed' || !t.vehicleId) continue
    const l = litresByTrip.get(t.id)
    const km = tripKm(t)
    if (l === undefined || km < 20) continue
    const cat = categoryByVehicle.get(t.vehicleId) ?? 'other'
    ;(sums[cat] ||= { l: 0, km: 0 })
    sums[cat]!.l += l
    sums[cat]!.km += km
  }
  const baseline: Record<string, number> = {}
  for (const [cat, s] of Object.entries(sums)) baseline[cat] = (s.l / s.km) * 100
  return { trips, events, litresByTrip, categoryByVehicle, baseline }
}

export interface PeriodStats {
  trips: number
  km: number
  onTimePct: number | null
  events: number
  highEvents: number
  eventsPer1000: number | null
  /** litres per 100 km over fuel-linked trips */
  fuelL100: number | null
  /** what the same trips would burn at fleet category averages */
  fuelExpectedL100: number | null
  fuelLitres: number
}

/** Stats for one driver (or the whole fleet when `driverId` is null) over a period. */
export function periodStats(ctx: PerfContext, driverId: string | null, inRange: InRange): PeriodStats {
  let trips = 0
  let km = 0
  let onTime = 0
  let fuelL = 0
  let fuelKm = 0
  let expectedL = 0
  for (const t of ctx.trips) {
    if (t.status !== 'completed') continue
    if (driverId ? t.driverId !== driverId : !t.driverId) continue
    if (!inRange(tripDate(t))) continue
    trips++
    const d = tripKm(t)
    km += d
    if (t.delayMinutes <= ON_TIME_GRACE_MIN) onTime++
    const l = ctx.litresByTrip.get(t.id)
    if (l !== undefined && d >= 20 && t.vehicleId) {
      fuelL += l
      fuelKm += d
      expectedL += (d * (ctx.baseline[ctx.categoryByVehicle.get(t.vehicleId) ?? 'other'] ?? 0)) / 100
    }
  }
  let events = 0
  let high = 0
  for (const e of ctx.events) {
    if (driverId ? e.driverId !== driverId : !e.driverId) continue
    if (!inRange(e.timestamp)) continue
    events++
    if (e.severity === 'high') high++
  }
  return {
    trips,
    km: Math.round(km),
    onTimePct: trips ? Math.round((onTime / trips) * 100) : null,
    events,
    highEvents: high,
    eventsPer1000: km > 0 ? Math.round((events / km) * 10000) / 10 : null,
    fuelL100: fuelKm > 0 ? Math.round((fuelL / fuelKm) * 1000) / 10 : null,
    fuelExpectedL100: fuelKm > 0 ? Math.round((expectedL / fuelKm) * 1000) / 10 : null,
    fuelLitres: Math.round(fuelL),
  }
}

export type SeriesPoint = {
  label: string
  title: string
  trips: number
  onTimePct: number | null
  events: number
  km: number
  eventsPer1000: number
  fleetEventsPer1000: number
}

/** Per-bucket trips / on-time / events / events per 1,000 km for a driver and the fleet. */
export function driverSeries(ctx: PerfContext, driverId: string, buckets: Bucket[]): SeriesPoint[] {
  const n = buckets.length
  const trips = new Array<number>(n).fill(0)
  const onTime = new Array<number>(n).fill(0)
  const km = new Array<number>(n).fill(0)
  const events = new Array<number>(n).fill(0)
  const fKm = new Array<number>(n).fill(0)
  const fEvents = new Array<number>(n).fill(0)
  for (const t of ctx.trips) {
    if (t.status !== 'completed' || !t.driverId) continue
    const i = bucketIndex(buckets, toDate(tripDate(t)).getTime())
    if (i < 0) continue
    const d = tripKm(t)
    fKm[i]! += d
    if (t.driverId === driverId) {
      trips[i]!++
      km[i]! += d
      if (t.delayMinutes <= ON_TIME_GRACE_MIN) onTime[i]!++
    }
  }
  for (const e of ctx.events) {
    if (!e.driverId) continue
    const i = bucketIndex(buckets, toDate(e.timestamp).getTime())
    if (i < 0) continue
    fEvents[i]!++
    if (e.driverId === driverId) events[i]!++
  }
  return buckets.map((b, i) => ({
    label: b.label,
    title: b.title,
    trips: trips[i]!,
    onTimePct: trips[i]! ? Math.round((onTime[i]! / trips[i]!) * 100) : null,
    events: events[i]!,
    km: Math.round(km[i]!),
    eventsPer1000: km[i]! > 0 ? Math.round((events[i]! / km[i]!) * 10000) / 10 : 0,
    fleetEventsPer1000: fKm[i]! > 0 ? Math.round((fEvents[i]! / fKm[i]!) * 10000) / 10 : 0,
  }))
}

const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3 } as const

/**
 * Rolling safety score estimate. The driver's current rating is the anchor (last point); earlier points move
 * with the trailing 28-day weighted event rate relative to today's rate, so improvement / decline is visible.
 */
export function scoreTrend(ctx: PerfContext, driver: Pick<Driver, 'id' | 'safetyScore'>, buckets: Bucket[], now = Date.now()) {
  const WIN = 28 * 864e5
  const mine = ctx.trips.filter((t) => t.status === 'completed' && t.driverId === driver.id).map((t) => ({ ts: toDate(tripDate(t)).getTime(), km: tripKm(t) }))
  const evs = ctx.events.filter((e) => e.driverId === driver.id).map((e) => ({ ts: toDate(e.timestamp).getTime(), w: SEVERITY_WEIGHT[e.severity] }))
  const rateAt = (end: number): number | null => {
    let km = 0
    let w = 0
    for (const t of mine) if (t.ts > end - WIN && t.ts <= end) km += t.km
    if (km < 150) return null
    for (const e of evs) if (e.ts > end - WIN && e.ts <= end) w += e.w
    return (w / km) * 1000
  }
  const base = rateAt(now)
  let prev = driver.safetyScore
  return buckets.map((b) => {
    const end = Math.min(b.end - 1, now)
    const r = base === null ? null : rateAt(end)
    const score = r === null || base === null ? prev : clamp(Math.round(driver.safetyScore + (base - r) * 1.4), 40, 100)
    prev = score
    return { label: b.label, title: b.title, score }
  })
}

/** Normalised (0-100) spokes for the radar chart. */
export function radarMetrics(p: PeriodStats, extra: { safety: number; compliancePct: number; tripsVsBest: number }) {
  const onTime = p.onTimePct ?? 0
  const fuelIdx = p.fuelL100 !== null && p.fuelExpectedL100 ? clamp(75 + ((p.fuelExpectedL100 - p.fuelL100) / p.fuelExpectedL100) * 250, 0, 100) : 75
  const eventIdx = p.eventsPer1000 === null ? 100 : clamp(100 - p.eventsPer1000 * 8, 0, 100)
  return [
    { metric: 'Safety score', value: Math.round(extra.safety) },
    { metric: 'On-time', value: Math.round(onTime) },
    { metric: 'Fuel economy', value: Math.round(fuelIdx) },
    { metric: 'Low-risk driving', value: Math.round(eventIdx) },
    { metric: 'Compliance', value: Math.round(extra.compliancePct) },
    { metric: 'Trip volume', value: Math.round(extra.tripsVsBest) },
  ]
}
