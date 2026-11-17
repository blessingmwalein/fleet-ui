import type { DailyStat, FuelTransaction, Trip, Vehicle } from '@/types'

/** Distinct vehicles that started a completed trip on each (UTC) day — mirrors how `dailyStats` is seeded. */
function tripVehiclesByDay(trips: Trip[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const t of trips) {
    if (t.status !== 'completed' || !t.vehicleId || !t.actualStart) continue
    const k = t.actualStart.slice(0, 10)
    let s = m.get(k)
    if (!s) m.set(k, (s = new Set()))
    s.add(t.vehicleId)
  }
  return m
}

/**
 * `dailyStats` is a company-wide telematics aggregate. When a branch is selected we derive an equivalent
 * branch series: real trip activity for that branch plus a pro-rata share of the non-trip telematics activity.
 */
export function scopeDailyStats(
  stats: DailyStat[],
  opts: { isAll: boolean; allVehicles: Vehicle[]; vehicles: Vehicle[]; allTrips: Trip[]; trips: Trip[]; fuel: FuelTransaction[] },
): DailyStat[] {
  if (opts.isAll) return stats
  const activeAll = opts.allVehicles.filter((v) => v.status === 'active').length || 1
  const activeScoped = opts.vehicles.filter((v) => v.status === 'active').length
  const share = activeScoped / activeAll
  const tripAll = tripVehiclesByDay(opts.allTrips)
  const tripScoped = tripVehiclesByDay(opts.trips)
  const fuelByDay = new Map<string, number>()
  for (const f of opts.fuel) {
    const k = f.date.slice(0, 10)
    fuelByDay.set(k, (fuelByDay.get(k) ?? 0) + f.litres)
  }
  return stats.map((d) => {
    const inService = Math.round(d.inService * share)
    const extra = Math.max(0, d.activeVehicles - (tripAll.get(d.date)?.size ?? 0)) * share
    const active = Math.min(inService, Math.round((tripScoped.get(d.date)?.size ?? 0) + extra))
    const ratio = d.activeVehicles ? active / d.activeVehicles : 0
    return {
      ...d,
      inService,
      activeVehicles: active,
      utilisationPct: inService ? Math.round((active / inService) * 1000) / 10 : 0,
      drivingHours: Math.round(d.drivingHours * ratio * 10) / 10,
      idleHours: Math.round(d.idleHours * ratio * 10) / 10,
      distanceKm: Math.round(d.distanceKm * ratio),
      fuelL: Math.round(fuelByDay.get(d.date) ?? 0),
    }
  })
}
