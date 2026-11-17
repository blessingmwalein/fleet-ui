import { useEffect, useMemo, useState } from 'react'
import { useDb } from '@/store/db'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { makeBuckets } from '@/lib/analytics'
import {
  buildDriverRisk, eventPoints, fleetRiskIndex, HARSH_TYPES, INCIDENT_POINTS, trendGranularity,
} from './safety'

/** Re-render on an interval so relative timestamps ("2 min ago") and expiry states stay fresh. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/**
 * Single source of truth for the safety module: branch-scoped and date-range-filtered events, incidents and
 * completed-trip distance, plus the driver risk table. Recomputes live when the simulator adds events/incidents.
 */
export function useSafetyData() {
  const range = useDateRange()
  const { scope, branchId } = useBranchScope()
  const allEvents = useDb((s) => s.safetyEvents)
  const allIncidents = useDb((s) => s.incidents)
  const allTrips = useDb((s) => s.trips)
  const allDrivers = useDb((s) => s.drivers)
  const allVehicles = useDb((s) => s.vehicles)
  const auditLog = useDb((s) => s.auditLog)

  const coached = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of auditLog) if (a.entityType === 'driver' && a.summary.startsWith('Coaching') && !m.has(a.entityId)) m.set(a.entityId, a.at)
    return m
  }, [auditLog])

  return useMemo(() => {
    const drivers = scope(allDrivers)
    const vehicles = scope(allVehicles)
    const scopedEvents = scope(allEvents)
    const scopedIncidents = scope(allIncidents)
    const events = scopedEvents.filter((e) => range.inRange(e.timestamp))
    const prevEvents = scopedEvents.filter((e) => range.inPrevRange(e.timestamp))
    const incidents = scopedIncidents.filter((i) => range.inRange(i.date))
    const prevIncidents = scopedIncidents.filter((i) => range.inPrevRange(i.date))
    const completed = scope(allTrips).filter((t) => t.status === 'completed' && t.actualDistanceKm)
    const trips = completed.filter((t) => range.inRange(t.actualEnd ?? t.actualStart))
    const prevTrips = completed.filter((t) => range.inPrevRange(t.actualEnd ?? t.actualStart))
    const km = trips.reduce((s, t) => s + (t.actualDistanceKm ?? 0), 0)
    const prevKm = prevTrips.reduce((s, t) => s + (t.actualDistanceKm ?? 0), 0)

    const sumPoints = (es: typeof events, is: typeof incidents) => es.reduce((s, e) => s + eventPoints(e), 0) + is.reduce((s, i) => s + INCIDENT_POINTS[i.severity] * 0.5, 0)
    const points = sumPoints(events, incidents)
    const prevPoints = sumPoints(prevEvents, prevIncidents)
    const trendBuckets = makeBuckets(range.from, range.to, trendGranularity(range.days))
    const driverRisk = buildDriverRisk(drivers, events, incidents, trips, trendBuckets, coached)

    return {
      range,
      branchId,
      drivers,
      vehicles,
      scopedEvents,
      scopedIncidents,
      events,
      prevEvents,
      incidents,
      prevIncidents,
      trips,
      km,
      prevKm,
      harshCount: events.filter((e) => HARSH_TYPES.has(e.type)).length,
      prevHarshCount: prevEvents.filter((e) => HARSH_TYPES.has(e.type)).length,
      riskIndex: fleetRiskIndex(points, km),
      prevRiskIndex: fleetRiskIndex(prevPoints, prevKm),
      driverRisk,
      trendBuckets,
      coached,
    }
  }, [range, scope, branchId, allEvents, allIncidents, allTrips, allDrivers, allVehicles, coached])
}
