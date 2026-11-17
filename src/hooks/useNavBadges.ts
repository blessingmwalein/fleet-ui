import { useMemo } from 'react'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import type { NavBadgeKey } from '@/config/navigation'

export interface NavBadge {
  count: number
  tone: 'danger' | 'warning' | 'info' | 'success'
}

/** Counts shown next to sidebar items (live — they update as the simulation runs). */
export function useNavBadges(): Partial<Record<NavBadgeKey, NavBadge>> {
  const trips = useDb((s) => s.trips)
  const workOrders = useDb((s) => s.workOrders)
  const expenses = useDb((s) => s.expenses)
  const incidents = useDb((s) => s.incidents)
  const moving = useLive((s) => {
    let n = 0
    for (const id in s.telemetry) if (s.telemetry[id]!.state === 'moving') n++
    return n
  })
  return useMemo(() => {
    const dispatch = trips.filter((t) => t.status === 'delayed' || t.status === 'awaiting_assignment').length
    const maintenance = workOrders.filter((w) => w.status === 'requested' || w.status === 'in_progress').length
    const finance = expenses.filter((e) => e.status === 'pending').length
    const safety = incidents.filter((i) => i.status === 'reported' || i.status === 'investigating').length
    const out: Partial<Record<NavBadgeKey, NavBadge>> = {}
    if (dispatch) out.dispatch = { count: dispatch, tone: 'warning' }
    if (maintenance) out.maintenance = { count: maintenance, tone: 'info' }
    if (finance) out.finance = { count: finance, tone: 'warning' }
    if (safety) out.safety = { count: safety, tone: 'danger' }
    if (moving) out.tracking = { count: moving, tone: 'success' }
    return out
  }, [trips, workOrders, expenses, incidents, moving])
}
