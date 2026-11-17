import { useMemo } from 'react'
import type { LiveState, Telemetry, Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useBranchScope } from '@/hooks/useFilters'

export interface TrackRow {
  id: string
  reg: string
  vehicle: Vehicle
  model: string
  driverId: string | null
  driverName: string
  state: LiveState
  speed: number
  fuel: number
  location: string
  tel: Telemetry | undefined
  /** lower-cased search haystack */
  hay: string
}

export const STATE_ORDER: LiveState[] = ['moving', 'idle', 'stopped', 'maintenance', 'offline']

/** Vehicles joined with live telemetry & driver — the single data source for the tracking workspace. */
export function useTrackingRows(): TrackRow[] {
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const telemetry = useLive((s) => s.telemetry)
  const { scope } = useBranchScope()
  return useMemo(() => {
    const dn = new Map(drivers.map((d) => [d.id, d.name]))
    return scope(vehicles).map<TrackRow>((v) => {
      const tel = telemetry[v.id]
      const driverName = dn.get(v.driverId ?? '') ?? 'Unassigned'
      const state: LiveState = tel?.state ?? (v.status === 'maintenance' ? 'maintenance' : v.status === 'out_of_service' ? 'offline' : 'stopped')
      return {
        id: v.id,
        reg: v.reg,
        vehicle: v,
        model: `${v.make} ${v.model}`,
        driverId: v.driverId,
        driverName,
        state,
        speed: tel?.speedKph ?? 0,
        fuel: tel?.fuelPct ?? v.fuelPct,
        location: tel?.location ?? '—',
        tel,
        hay: `${v.reg} ${v.make} ${v.model} ${driverName} ${v.category.replace('_', ' ')} ${tel?.location ?? ''}`.toLowerCase(),
      }
    })
  }, [vehicles, drivers, telemetry, scope])
}
