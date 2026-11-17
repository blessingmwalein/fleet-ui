import { useMemo } from 'react'
import type { Driver, Trip } from '@/types'
import { useDb } from '@/store/db'
import type { Tone } from '@/components/ui/display'
import { expiryState } from '@/config/status'

/* ----------------------------------------------------------------------------------------------
 * Shared constants & derived-value helpers for the drivers module.
 * -------------------------------------------------------------------------------------------- */

export const isActiveTrip = (t: Pick<Trip, 'status'>) => t.status === 'in_transit' || t.status === 'delayed'
export const isUpcomingTrip = (t: Pick<Trip, 'status'>) => t.status === 'scheduled' || t.status === 'ready' || t.status === 'awaiting_assignment'
/** A completed trip is "on time" when it finished within 15 minutes of plan. */
export const ON_TIME_GRACE_MIN = 15
export const tripKm = (t: Trip) => t.actualDistanceKm ?? t.plannedDistanceKm
/** The timestamp a completed trip counts towards in period analytics. */
export const tripDate = (t: Trip) => t.actualEnd ?? t.actualStart ?? t.scheduledStart

export type SafetyBand = 'good' | 'fair' | 'poor'
/** Safety score bands: >=85 green, 70-84 amber, <70 red. */
export const safetyBand = (score: number): SafetyBand => (score >= 85 ? 'good' : score >= 70 ? 'fair' : 'poor')
export const BAND_META: Record<SafetyBand, { label: string; tone: Tone; color: string }> = {
  good: { label: 'Good (85+)', tone: 'success', color: 'var(--success)' },
  fair: { label: 'Fair (70–84)', tone: 'warning', color: 'var(--warning)' },
  poor: { label: 'At risk (<70)', tone: 'danger', color: 'var(--danger)' },
}
export const scoreColor = (score: number) => BAND_META[safetyBand(score)].color

export type LicenceState = 'expired' | 'expiring' | 'valid'
export const LICENCE_STATE_LABEL: Record<LicenceState, string> = { expired: 'Expired', expiring: 'Expiring ≤30d', valid: 'Valid' }

export const LICENCE_CLASSES = [
  { value: 'Class 1', label: 'Class 1 · Heavy articulated' },
  { value: 'Class 2', label: 'Class 2 · Heavy rigid / light truck' },
  { value: 'Class 3', label: 'Class 3 · Medium / minibus' },
  { value: 'Class 4', label: 'Class 4 · Light vehicles' },
]
export const HEAVY_CATEGORIES = ['heavy_truck', 'tanker', 'refrigerated', 'bus']
export const HEAVY_LICENCE_CLASSES = ['Class 1', 'Class 2']

export const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'casual', label: 'Casual' },
]
export const EMPLOYMENT_LABEL: Record<Driver['employmentType'], string> = { permanent: 'Permanent', contract: 'Contract', casual: 'Casual' }
export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]
export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'off_duty', label: 'Off duty' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'suspended', label: 'Suspended' },
]

export function ageOf(dobIso: string, now = Date.now()) {
  return Math.floor((now - new Date(dobIso).getTime()) / (365.25 * 864e5))
}
/** "3 yrs 4 mos" style tenure. */
export function tenureLabel(fromIso: string, now = Date.now()) {
  const months = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / (30.4375 * 864e5)))
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo${m === 1 ? '' : 's'}`
  return m ? `${y} yr${y === 1 ? '' : 's'} ${m} mo${m === 1 ? '' : 's'}` : `${y} yr${y === 1 ? '' : 's'}`
}

/** Dispatch readiness: what stops a driver from being rostered right now. */
export function dispatchBlockers(d: Pick<Driver, 'status' | 'licenceExpiry' | 'medicalExpiry' | 'defensiveDrivingExpiry'>, now = Date.now()) {
  const out: { key: string; label: string; severity: 'block' | 'warn' }[] = []
  if (d.status === 'suspended') out.push({ key: 'status', label: 'Driver is suspended', severity: 'block' })
  else if (d.status === 'on_leave') out.push({ key: 'status', label: 'Driver is on leave', severity: 'block' })
  else if (d.status === 'off_duty') out.push({ key: 'status', label: 'Driver is off duty', severity: 'warn' })
  const lic = expiryState(d.licenceExpiry, 30, now)
  if (lic.state === 'expired') out.push({ key: 'licence', label: `Driving licence expired (${-lic.days}d ago)`, severity: 'block' })
  else if (lic.state === 'expiring') out.push({ key: 'licence', label: `Driving licence expires in ${lic.days}d`, severity: 'warn' })
  const med = expiryState(d.medicalExpiry, 30, now)
  if (med.state === 'expired') out.push({ key: 'medical', label: `Medical certificate expired (${-med.days}d ago)`, severity: 'block' })
  else if (med.state === 'expiring') out.push({ key: 'medical', label: `Medical certificate expires in ${med.days}d`, severity: 'warn' })
  const dd = expiryState(d.defensiveDrivingExpiry, 30, now)
  if (dd.state === 'expired') out.push({ key: 'dd', label: `Defensive-driving training lapsed (${-dd.days}d ago)`, severity: 'warn' })
  else if (dd.state === 'expiring') out.push({ key: 'dd', label: `Defensive-driving training expires in ${dd.days}d`, severity: 'warn' })
  return out
}

/* ----------------------------------------------------------------------------------------------
 * Enriched list rows (TanStack caches accessor values — see ARCHITECTURE gotcha — so everything the
 * table sorts/searches/exports is flattened onto plain row objects here, in a useMemo).
 * -------------------------------------------------------------------------------------------- */

export interface DriverRow extends Driver {
  branchName: string
  vehicleReg: string
  vehicleLabel: string
  tripsCompleted: number
  distanceKm: number
  onTimePct: number | null
  eventCount: number
  eventsPer1000: number | null
  activeTripId: string | null
  activeTripRef: string
  licenceState: LicenceState
  licenceDays: number
  band: SafetyBand
  bandLabel: string
}

export function useDriverRows(): DriverRow[] {
  const drivers = useDb((s) => s.drivers)
  const trips = useDb((s) => s.trips)
  const vehicles = useDb((s) => s.vehicles)
  const branches = useDb((s) => s.branches)
  const events = useDb((s) => s.safetyEvents)
  return useMemo(() => {
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
    const branchById = new Map(branches.map((b) => [b.id, b]))
    const agg = new Map<string, { completed: number; onTime: number; km: number; active: Trip | null }>()
    for (const t of trips) {
      if (!t.driverId) continue
      let a = agg.get(t.driverId)
      if (!a) {
        a = { completed: 0, onTime: 0, km: 0, active: null }
        agg.set(t.driverId, a)
      }
      if (t.status === 'completed') {
        a.completed++
        if (t.delayMinutes <= ON_TIME_GRACE_MIN) a.onTime++
        a.km += tripKm(t)
      } else if (isActiveTrip(t)) a.active = t
    }
    const eventCount = new Map<string, number>()
    for (const e of events) if (e.driverId) eventCount.set(e.driverId, (eventCount.get(e.driverId) ?? 0) + 1)
    const now = Date.now()
    return drivers.map<DriverRow>((d) => {
      const a = agg.get(d.id)
      const v = d.vehicleId ? vehicleById.get(d.vehicleId) : undefined
      const lic = expiryState(d.licenceExpiry, 30, now)
      const band = safetyBand(d.safetyScore)
      const ev = eventCount.get(d.id) ?? 0
      return {
        ...d,
        branchName: branchById.get(d.branchId)?.name ?? '—',
        vehicleReg: v?.reg ?? '',
        vehicleLabel: v ? `${v.reg} · ${v.make} ${v.model}` : '',
        tripsCompleted: a?.completed ?? 0,
        distanceKm: Math.round(a?.km ?? 0),
        onTimePct: a && a.completed ? Math.round((a.onTime / a.completed) * 100) : null,
        eventCount: ev,
        eventsPer1000: a && a.km > 0 ? Math.round((ev / a.km) * 10000) / 10 : null,
        activeTripId: a?.active?.id ?? null,
        activeTripRef: a?.active?.ref ?? '',
        licenceState: lic.state === 'unknown' ? 'valid' : lic.state,
        licenceDays: lic.days,
        band,
        bandLabel: BAND_META[band].label,
      }
    })
  }, [drivers, trips, vehicles, branches, events])
}
