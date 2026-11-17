/**
 * Safety & compliance domain logic: event weights, risk scoring, heat-map and hotspot helpers.
 * Pure functions only (no React) so every safety screen scores drivers and fleet risk identically.
 */
import type { Driver, Incident, IncidentType, SafetyEvent, SafetyEventType, Trip } from '@/types'
import { bucketIndex, type Bucket } from '@/lib/analytics'
import type { Tone } from '@/components/ui/display'
import { clamp } from '@/lib/utils'

export const EVENT_TYPES: SafetyEventType[] = ['speeding', 'harsh_braking', 'harsh_acceleration', 'harsh_cornering', 'fatigue', 'seatbelt', 'phone_use', 'idling']
export const HARSH_TYPES: ReadonlySet<SafetyEventType> = new Set<SafetyEventType>(['harsh_braking', 'harsh_acceleration', 'harsh_cornering'])

/** Stable colour per event type (theme tokens from the chart palette). */
export const EVENT_COLOR: Record<SafetyEventType, string> = {
  speeding: 'var(--chart-3)',
  harsh_braking: 'var(--chart-6)',
  harsh_acceleration: 'var(--chart-2)',
  harsh_cornering: 'var(--chart-4)',
  fatigue: 'var(--chart-8)',
  seatbelt: 'var(--chart-5)',
  phone_use: 'var(--chart-1)',
  idling: 'var(--chart-7)',
}

/** How much each event type contributes to risk (before severity). */
export const EVENT_WEIGHT: Record<SafetyEventType, number> = {
  harsh_braking: 1, harsh_acceleration: 0.8, speeding: 1, harsh_cornering: 0.8, fatigue: 1.5, phone_use: 2, seatbelt: 1.2, idling: 0.2,
}
export const SEVERITY_FACTOR: Record<SafetyEvent['severity'], number> = { low: 0.6, medium: 1, high: 1.8 }
export const INCIDENT_POINTS: Record<Incident['severity'], number> = { minor: 2, moderate: 5, major: 12, critical: 25 }
export const INCIDENT_SEVERITY_ORDER: Incident['severity'][] = ['minor', 'moderate', 'major', 'critical']
export const INCIDENT_SEVERITY_COLOR: Record<Incident['severity'], string> = {
  minor: 'var(--chart-2)', moderate: 'var(--chart-3)', major: 'var(--chart-6)', critical: 'color-mix(in oklab, var(--danger) 55%, var(--chart-4))',
}

export const eventPoints = (e: Pick<SafetyEvent, 'type' | 'severity'>) => EVENT_WEIGHT[e.type] * SEVERITY_FACTOR[e.severity]

/** Floor on distance so a handful of km can't blow a rate up. */
export const MIN_KM = 150
const RISK_FACTOR = 7
const PRIOR_KM = 400
const PRIOR_POINTS = 1

/** Fleet risk index 0–100 (lower is better): severity-weighted events + incidents per 1,000 km. */
export function fleetRiskIndex(points: number, km: number): number {
  return clamp(Math.round((points / Math.max(km, MIN_KM)) * 1000 * RISK_FACTOR), 0, 100)
}

export function riskBand(index: number): { label: string; tone: Tone } {
  if (index < 30) return { label: 'Low', tone: 'success' }
  if (index < 55) return { label: 'Moderate', tone: 'warning' }
  return { label: 'High', tone: 'danger' }
}

/** Driver score 0–100 (higher is better) from weighted events per distance, with a small prior so short samples don't swing wildly. */
export function driverScoreFrom(points: number, km: number, incidentPts: number, baseline: number): number {
  if (km < 100 && points === 0 && incidentPts === 0) return baseline
  const per1000 = ((points + PRIOR_POINTS) / (km + PRIOR_KM)) * 1000
  return clamp(Math.round(100 - 3.5 * per1000 - incidentPts * 1.2), 20, 100)
}

export const COACHING_BELOW = 75

export function scoreTone(score: number): Tone {
  return score >= 85 ? 'success' : score >= COACHING_BELOW ? 'warning' : 'danger'
}
export const scoreLabel = (score: number) => (score >= 85 ? 'Good' : score >= COACHING_BELOW ? 'Watch' : 'Coach')
export const toneVar: Record<Tone, string> = {
  success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)', primary: 'var(--primary)', neutral: 'var(--subtle-foreground)', outline: 'var(--foreground)',
}

export interface DriverRisk {
  id: string
  driver: Driver
  name: string
  km: number
  trips: number
  events: number
  unreviewed: number
  harsh: number
  speeding: number
  fatigue: number
  incidents: number
  points: number
  per1000: number
  score: number
  topType: SafetyEventType | null
  topCount: number
  trend: number[]
  coaching: boolean
  lastCoached: string | null
}

/**
 * Score every driver over the supplied (already range-filtered) events, incidents and completed trips.
 * `buckets` drive the per-driver trend sparkline.
 */
export function buildDriverRisk(drivers: Driver[], events: SafetyEvent[], incidents: Incident[], trips: Trip[], buckets: Bucket[], coached: Map<string, string>): DriverRisk[] {
  const evBy = new Map<string, SafetyEvent[]>()
  for (const e of events) if (e.driverId) (evBy.get(e.driverId) ?? evBy.set(e.driverId, []).get(e.driverId)!).push(e)
  const incBy = new Map<string, Incident[]>()
  for (const i of incidents) if (i.driverId) (incBy.get(i.driverId) ?? incBy.set(i.driverId, []).get(i.driverId)!).push(i)
  const tripBy = new Map<string, Trip[]>()
  for (const t of trips) if (t.driverId) (tripBy.get(t.driverId) ?? tripBy.set(t.driverId, []).get(t.driverId)!).push(t)

  return drivers.map((driver) => {
    const evs = evBy.get(driver.id) ?? []
    const incs = incBy.get(driver.id) ?? []
    const trs = tripBy.get(driver.id) ?? []
    const km = trs.reduce((s, t) => s + (t.actualDistanceKm ?? 0), 0)
    const points = evs.reduce((s, e) => s + eventPoints(e), 0)
    const incidentPts = incs.reduce((s, i) => s + INCIDENT_POINTS[i.severity], 0)
    const score = driverScoreFrom(points, km, incidentPts, driver.safetyScore)

    const typeCount = new Map<SafetyEventType, number>()
    for (const e of evs) typeCount.set(e.type, (typeCount.get(e.type) ?? 0) + 1)
    const top = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0]

    // trend: score per bucket (carry the overall score into buckets without enough data)
    const bp = new Array<number>(buckets.length).fill(0)
    const bk = new Array<number>(buckets.length).fill(0)
    const bi = new Array<number>(buckets.length).fill(0)
    for (const e of evs) {
      const i = bucketIndex(buckets, new Date(e.timestamp).getTime())
      if (i >= 0) bp[i]! += eventPoints(e)
    }
    for (const t of trs) {
      const i = bucketIndex(buckets, new Date(t.actualEnd ?? t.actualStart ?? t.scheduledStart).getTime())
      if (i >= 0) bk[i]! += t.actualDistanceKm ?? 0
    }
    for (const x of incs) {
      const i = bucketIndex(buckets, new Date(x.date).getTime())
      if (i >= 0) bi[i]! += INCIDENT_POINTS[x.severity]
    }
    const trend = buckets.map((_, i) => (bk[i]! < 60 && bp[i] === 0 ? score : driverScoreFrom(bp[i]!, bk[i]!, bi[i]!, score)))

    return {
      id: driver.id,
      driver,
      name: driver.name,
      km,
      trips: trs.length,
      events: evs.length,
      unreviewed: evs.filter((e) => !e.reviewed).length,
      harsh: evs.filter((e) => HARSH_TYPES.has(e.type)).length,
      speeding: evs.filter((e) => e.type === 'speeding').length,
      fatigue: evs.filter((e) => e.type === 'fatigue').length,
      incidents: incs.length,
      points,
      per1000: ((points + incidentPts) / Math.max(km, MIN_KM)) * 1000,
      score,
      topType: top?.[0] ?? null,
      topCount: top?.[1] ?? 0,
      trend,
      coaching: score < COACHING_BELOW,
      lastCoached: coached.get(driver.id) ?? null,
    }
  })
}

/** Sensible bucket size for per-driver trends: ~5–12 points regardless of range. */
export function trendGranularity(days: number): 'day' | 'week' | 'month' {
  return days <= 14 ? 'day' : days <= 150 ? 'week' : 'month'
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Day-of-week × time-of-day risk grid (rows Mon–Sun, columns of `binHours`). Weighted by event/incident severity. */
export function weekHeat(events: SafetyEvent[], incidents: Incident[], binHours = 2) {
  const cols = 24 / binHours
  const grid = Array.from({ length: 7 }, () => new Array<number>(cols).fill(0))
  const counts = Array.from({ length: 7 }, () => new Array<number>(cols).fill(0))
  for (const e of events) {
    const d = new Date(e.timestamp)
    const r = (d.getDay() + 6) % 7
    const c = Math.floor(d.getHours() / binHours)
    grid[r]![c]! += eventPoints(e)
    counts[r]![c]! += 1
  }
  for (const x of incidents) {
    const d = new Date(x.date)
    const r = (d.getDay() + 6) % 7
    const c = Math.floor(d.getHours() / binHours)
    grid[r]![c]! += INCIDENT_POINTS[x.severity] * 0.5
    counts[r]![c]! += 1
  }
  let max = 0
  for (const row of grid) for (const v of row) max = Math.max(max, v)
  return { grid, counts, max, cols, binHours }
}

/** "12 km N of Kadoma · A5" → "A5 corridor"; "Near Harare CBD" → "Harare CBD". */
export function hotspotKey(location: string): string {
  const [place, road] = location.split(' · ')
  if (road) return `${road.trim()} corridor`
  return (place ?? location).replace(/^Near /, '').replace(/^\d+ km [NESW]{1,2} of /, '').trim() || 'Unknown'
}

export function hotspots(items: { location: string }[], top = 8): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) {
    const k = hotspotKey(i.location)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
}

export const COACHING_TOPICS: { value: string; label: string; types: SafetyEventType[] }[] = [
  { value: 'speed', label: 'Speed management', types: ['speeding'] },
  { value: 'braking', label: 'Smooth braking & following distance', types: ['harsh_braking'] },
  { value: 'acceleration', label: 'Smooth acceleration & fuel economy', types: ['harsh_acceleration', 'idling'] },
  { value: 'cornering', label: 'Cornering & load stability', types: ['harsh_cornering'] },
  { value: 'fatigue', label: 'Fatigue management & rest breaks', types: ['fatigue'] },
  { value: 'policy', label: 'Seatbelt & mobile phone policy', types: ['seatbelt', 'phone_use'] },
  { value: 'defensive', label: 'General defensive driving', types: [] },
]

export function topicFor(type: SafetyEventType | null): string {
  return COACHING_TOPICS.find((t) => type && t.types.includes(type))?.value ?? 'defensive'
}

export const INCIDENT_TYPE_KEYS: IncidentType[] = ['collision', 'rollover', 'theft', 'breakdown', 'cargo_damage', 'near_miss', 'injury', 'fire', 'hijack', 'other']

/** Incident types/severities that legally require a police report number. */
export function policeReportRequired(d: { type: IncidentType; severity: Incident['severity']; injuries: number; thirdPartyInvolved: boolean }) {
  return d.injuries > 0 || d.severity === 'major' || d.severity === 'critical' || ['theft', 'hijack', 'rollover'].includes(d.type) || (d.type === 'collision' && d.thirdPartyInvolved)
}
