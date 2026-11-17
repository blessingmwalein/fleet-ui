import { useMemo } from 'react'
import type { LiveState, Telemetry, Vehicle } from '@/types'
import { useLive } from '@/store/live'
import { useDash } from './useDashboardScope'

export interface LiveVehicle {
  vehicle: Vehicle
  t: Telemetry | undefined
  state: LiveState
}

export interface FleetLive {
  /** false until the simulator has produced its first fix */
  ready: boolean
  rows: LiveVehicle[]
  counts: Record<LiveState, number>
  total: number
  /** moving + idle */
  active: number
  /** vehicles that are neither in maintenance nor offline */
  availablePct: number
}

export const LIVE_ORDER: LiveState[] = ['moving', 'idle', 'stopped', 'maintenance', 'offline']

/** Effective live state: telemetry when present, otherwise derived from the administrative status. */
export function liveStateOf(v: Vehicle, t: Telemetry | undefined): LiveState {
  if (t) return t.state
  return v.status === 'maintenance' ? 'maintenance' : v.status === 'out_of_service' ? 'offline' : 'stopped'
}

/** Branch-scoped live fleet snapshot. Re-computes on every simulator tick (~2 s) — only use in live widgets. */
export function useFleetLive(): FleetLive {
  const { vehicles } = useDash()
  const telemetry = useLive((s) => s.telemetry)
  return useMemo(() => {
    const counts: Record<LiveState, number> = { moving: 0, idle: 0, stopped: 0, maintenance: 0, offline: 0 }
    const rows = vehicles.map((vehicle) => {
      const t = telemetry[vehicle.id]
      const state = liveStateOf(vehicle, t)
      counts[state]++
      return { vehicle, t, state }
    })
    const total = rows.length
    return {
      ready: Object.keys(telemetry).length > 0,
      rows,
      counts,
      total,
      active: counts.moving + counts.idle,
      availablePct: total ? ((total - counts.maintenance - counts.offline) / total) * 100 : 0,
    }
  }, [vehicles, telemetry])
}
