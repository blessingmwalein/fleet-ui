import { useMemo } from 'react'
import type { Vehicle } from '@/types'
import { useLive } from '@/store/live'
import { complianceOf, operatingCost, serviceInfo, statusKeyOf, utilisationOf } from './lib'
import { isActiveTrip } from './actions'
import { useVehicleDocuments, useVehicleExpenses, useVehicleFuel, useVehicleIncidents, useVehicleSchedules, useVehicleTrips, useVehicleWorkOrders } from './useVehicleData'

const DAY = 864e5

/** Everything the detail header, KPI row and Overview tab need, derived from the live database + telemetry. */
export function useVehicleKpis(v: Vehicle) {
  const live = useLive((s) => s.telemetry[v.id])
  const trips = useVehicleTrips(v.id)
  const fuel = useVehicleFuel(v.id)
  const workOrders = useVehicleWorkOrders(v.id)
  const expenses = useVehicleExpenses(v.id)
  const schedules = useVehicleSchedules(v.id)
  const docs = useVehicleDocuments(v.id)
  const incidents = useVehicleIncidents(v.id)

  return useMemo(() => {
    const now = Date.now()
    const odometer = Math.round(live?.odometerKm ?? v.odometerKm)
    const fuelPct = Math.round(live?.fuelPct ?? v.fuelPct)
    const utilisation = utilisationOf(trips, now, 30)
    const cost = operatingCost({ trips, fuel, workOrders, expenses }, now - 90 * DAY, now)
    const service = serviceInfo(schedules, odometer, now)
    const compliance = complianceOf(v.category, docs, 30, now)
    const incidents90 = incidents.filter((i) => now - new Date(i.date).getTime() <= 90 * DAY).length
    const openWorkOrders = workOrders.filter((w) => ['requested', 'approved', 'scheduled', 'in_progress'].includes(w.status))
    const activeTrip = trips.find(isActiveTrip)
    const upcomingTrips = trips.filter((t) => t.status === 'scheduled' || t.status === 'ready').sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
    const gpsDown = v.status === 'active' && (live ? !live.gpsOnline : false)

    let health = 100
    health -= compliance.expired * 20 + compliance.missing * 10 + compliance.expiring * 4
    health -= Math.min(2, service.overdueCount) * 12
    if (fuelPct < 15) health -= 6
    if (gpsDown) health -= 8
    health -= Math.min(3, incidents90) * 4
    if (v.status === 'out_of_service') health -= 20
    health = Math.max(0, Math.min(100, Math.round(health)))

    return {
      live, statusKey: statusKeyOf(v, live), odometer, fuelPct, utilisation, cost, service, compliance, incidents90, openWorkOrders, activeTrip, upcomingTrips, gpsDown, health,
    }
  }, [v, live, trips, fuel, workOrders, expenses, schedules, docs, incidents])
}

export type VehicleKpis = ReturnType<typeof useVehicleKpis>
