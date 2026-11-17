import { useMemo } from 'react'
import type { Inspection, ServiceSchedule, Vehicle, WorkOrder } from '@/types'
import { useDb } from '@/store/db'
import { useBranchScope } from '@/hooks/useFilters'
import { WORKORDER_TYPE } from '@/config/status'
import { isLateStart, isOpen, linkedScheduleId, scheduleHealth, useMinuteTick, useOdometers, woCost, type ScheduleHealth } from './maintenance'

export interface WoRow extends WorkOrder {
  reg: string
  vehicleName: string
  providerName: string
  branchName: string
  typeLabel: string
  totalCost: number
  late: boolean
  linkedScheduleId: string | null
}

export interface ScheduleRow extends ServiceSchedule {
  reg: string
  vehicleName: string
  branchId: string
  branchName: string
  category: Vehicle['category'] | ''
  odometerKm: number
  health: ScheduleHealth
  state: ScheduleHealth['state']
  stateLabel: string
  remaining: string
  /** open work order raised from this schedule (if any) */
  openWoId: string | null
  openWoNo: string | null
}

export interface InspectionRow extends Inspection {
  reg: string
  vehicleName: string
  branchName: string
  defectCount: number
  driverName: string
}

export interface ProviderStat {
  jobs: number
  completed: number
  open: number
  inProgress: number
  spend: number
  avgCost: number
  avgDowntime: number
  lastJobAt: string | null
}

/** Work orders limited to the global branch scope. */
export function useScopedWorkOrders() {
  const workOrders = useDb((s) => s.workOrders)
  const { scope } = useBranchScope()
  return useMemo(() => scope(workOrders), [scope, workOrders])
}

export function useWorkOrderRows(): WoRow[] {
  const workOrders = useScopedWorkOrders()
  const vehicles = useDb((s) => s.vehicles)
  const providers = useDb((s) => s.providers)
  const branches = useDb((s) => s.branches)
  const tick = useMinuteTick()
  return useMemo(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const pById = new Map(providers.map((p) => [p.id, p]))
    const bById = new Map(branches.map((b) => [b.id, b]))
    void tick
    const now = Date.now()
    return workOrders.map<WoRow>((w) => {
      const v = vById.get(w.vehicleId)
      return {
        ...w,
        reg: v?.reg ?? '—',
        vehicleName: v ? `${v.make} ${v.model}` : '',
        providerName: pById.get(w.providerId)?.name ?? '—',
        branchName: bById.get(w.branchId)?.name ?? '—',
        typeLabel: WORKORDER_TYPE[w.type],
        totalCost: woCost(w),
        late: isLateStart(w, now),
        linkedScheduleId: linkedScheduleId(w.notes),
      }
    })
  }, [workOrders, vehicles, providers, branches, tick])
}

export function useScheduleRows(): ScheduleRow[] {
  const schedules = useDb((s) => s.schedules)
  const vehicles = useDb((s) => s.vehicles)
  const workOrders = useDb((s) => s.workOrders)
  const branches = useDb((s) => s.branches)
  const { branchId } = useBranchScope()
  const odometers = useOdometers()
  const tick = useMinuteTick()
  return useMemo(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const bById = new Map(branches.map((b) => [b.id, b]))
    const openBySchedule = new Map<string, WorkOrder>()
    for (const w of workOrders) {
      const sid = linkedScheduleId(w.notes)
      if (sid && isOpen(w)) openBySchedule.set(sid, w)
    }
    void tick
    const now = Date.now()
    const rows: ScheduleRow[] = []
    for (const s of schedules) {
      const v = vById.get(s.vehicleId)
      if (branchId !== 'all' && v?.branchId !== branchId) continue
      const odo = odometers.get(s.vehicleId) ?? v?.odometerKm ?? 0
      const health = scheduleHealth(s, odo, now)
      const wo = openBySchedule.get(s.id)
      rows.push({
        ...s,
        reg: v?.reg ?? '—',
        vehicleName: v ? `${v.make} ${v.model}` : '',
        branchId: v?.branchId ?? '',
        branchName: bById.get(v?.branchId ?? '')?.name ?? '—',
        category: v?.category ?? '',
        odometerKm: odo,
        health,
        state: health.state,
        stateLabel: health.state === 'overdue' ? 'Overdue' : health.state === 'due_soon' ? 'Due soon' : 'OK',
        remaining: health.remaining,
        openWoId: wo?.id ?? null,
        openWoNo: wo?.woNo ?? null,
      })
    }
    return rows
  }, [schedules, vehicles, workOrders, branches, branchId, odometers, tick])
}

export function useInspectionRows(): InspectionRow[] {
  const inspections = useDb((s) => s.inspections)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branches = useDb((s) => s.branches)
  const { scope } = useBranchScope()
  return useMemo(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const dById = new Map(drivers.map((d) => [d.id, d]))
    const bById = new Map(branches.map((b) => [b.id, b]))
    return scope(inspections).map<InspectionRow>((i) => {
      const v = vById.get(i.vehicleId)
      return {
        ...i,
        reg: v?.reg ?? '—',
        vehicleName: v ? `${v.make} ${v.model}` : '',
        branchName: bById.get(i.branchId)?.name ?? '—',
        defectCount: i.defects.length,
        driverName: dById.get(i.driverId ?? '')?.name ?? '',
      }
    })
  }, [inspections, vehicles, drivers, branches, scope])
}

/** Per-provider job counts and spend across all work orders (providers are company-wide, not branch-scoped). */
export function useProviderStats(): Map<string, ProviderStat> {
  const workOrders = useDb((s) => s.workOrders)
  return useMemo(() => {
    const m = new Map<string, ProviderStat & { dt: number }>()
    for (const w of workOrders) {
      const s = m.get(w.providerId) ?? { jobs: 0, completed: 0, open: 0, inProgress: 0, spend: 0, avgCost: 0, avgDowntime: 0, lastJobAt: null, dt: 0 }
      if (w.status !== 'cancelled') s.jobs += 1
      if (w.status === 'completed') {
        s.completed += 1
        s.spend += woCost(w)
        s.dt += w.downtimeHours
        if (w.completedAt && (!s.lastJobAt || w.completedAt > s.lastJobAt)) s.lastJobAt = w.completedAt
      }
      if (isOpen(w)) s.open += 1
      if (w.status === 'in_progress') s.inProgress += 1
      m.set(w.providerId, s)
    }
    const out = new Map<string, ProviderStat>()
    for (const [id, s] of m) out.set(id, { ...s, avgCost: s.completed ? s.spend / s.completed : 0, avgDowntime: s.completed ? s.dt / s.completed : 0 })
    return out
  }, [workOrders])
}

export const EMPTY_PROVIDER_STAT: ProviderStat = { jobs: 0, completed: 0, open: 0, inProgress: 0, spend: 0, avgCost: 0, avgDowntime: 0, lastJobAt: null }
