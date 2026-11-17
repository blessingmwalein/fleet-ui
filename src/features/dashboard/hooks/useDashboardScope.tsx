import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { startOfDay, subDays } from 'date-fns'
import type { DailyStat, DocumentRecord, Driver, EntityRef, Expense, FuelTransaction, Incident, SafetyEvent, ServiceSchedule, Trip, Vehicle, WorkOrder } from '@/types'
import { useDb } from '@/store/db'
import { useBranchScope, useDateRange, type DateRange } from '@/hooks/useFilters'
import { toDate } from '@/lib/format'
import { scopeDailyStats } from '../lib/dailyStats'

/** Charts always show at least 7 days so short presets (24h) still draw a meaningful trend. */
export interface TrendWindow {
  from: Date
  to: Date
  days: number
  /** true when the window is wider than the global date range */
  extended: boolean
  inRange: (v: string | number | Date | null | undefined) => boolean
}

export interface DashScope {
  range: DateRange
  trend: TrendWindow
  now: number
  isAll: boolean
  branchId: string
  branchName: string | null
  vehicles: Vehicle[]
  drivers: Driver[]
  trips: Trip[]
  fuel: FuelTransaction[]
  workOrders: WorkOrder[]
  expenses: Expense[]
  incidents: Incident[]
  safetyEvents: SafetyEvent[]
  schedules: ServiceSchedule[]
  documents: DocumentRecord[]
  /** telematics daily aggregates, derived per-branch when a branch is selected */
  dailyStats: DailyStat[]
  vehicleById: Map<string, Vehicle>
  driverById: Map<string, Driver>
  /** true when the referenced entity belongs to the selected branch (always true for "all branches") */
  inScopeEntity: (ref: EntityRef | null | undefined) => boolean
}

const Ctx = createContext<DashScope | null>(null)

export function useDash(): DashScope {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDash must be used inside <DashboardScopeProvider>')
  return v
}

/** Re-renders on an interval so "overdue / expires in" maths stay fresh. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function indexById<T extends { id: string }>(list: T[]) {
  return new Map(list.map((x) => [x.id, x]))
}

export function DashboardScopeProvider({ children }: { children: ReactNode }) {
  const range = useDateRange()
  const { branchId, branch, scope, isAll } = useBranchScope()
  const now = useNow()

  const allVehicles = useDb((s) => s.vehicles)
  const allDrivers = useDb((s) => s.drivers)
  const allTrips = useDb((s) => s.trips)
  const allFuel = useDb((s) => s.fuelTransactions)
  const allWorkOrders = useDb((s) => s.workOrders)
  const allExpenses = useDb((s) => s.expenses)
  const allIncidents = useDb((s) => s.incidents)
  const allSafety = useDb((s) => s.safetyEvents)
  const allSchedules = useDb((s) => s.schedules)
  const allDocuments = useDb((s) => s.documents)
  const allDaily = useDb((s) => s.dailyStats)
  const allShipments = useDb((s) => s.shipments)
  const allInvoices = useDb((s) => s.invoices)

  const trend = useMemo<TrendWindow>(() => {
    const from = range.days >= 7 ? range.from : startOfDay(subDays(range.to, 6))
    const f = from.getTime()
    const t = range.to.getTime()
    return {
      from,
      to: range.to,
      days: range.days >= 7 ? range.days : 7,
      extended: range.days < 7,
      inRange: (v) => {
        if (v === null || v === undefined) return false
        const x = toDate(v).getTime()
        return x >= f && x <= t
      },
    }
  }, [range])

  const vehicles = useMemo(() => scope(allVehicles), [scope, allVehicles])
  const drivers = useMemo(() => scope(allDrivers), [scope, allDrivers])
  const trips = useMemo(() => scope(allTrips), [scope, allTrips])
  const fuel = useMemo(() => scope(allFuel), [scope, allFuel])
  const workOrders = useMemo(() => scope(allWorkOrders), [scope, allWorkOrders])
  const expenses = useMemo(() => scope(allExpenses), [scope, allExpenses])
  const incidents = useMemo(() => scope(allIncidents), [scope, allIncidents])
  const safetyEvents = useMemo(() => scope(allSafety), [scope, allSafety])
  const vehicleById = useMemo(() => indexById(vehicles), [vehicles])
  const driverById = useMemo(() => indexById(drivers), [drivers])
  const schedules = useMemo(() => allSchedules.filter((s) => vehicleById.has(s.vehicleId)), [allSchedules, vehicleById])
  const documents = useMemo(() => {
    const allV = indexById(allVehicles)
    const allD = indexById(allDrivers)
    return allDocuments.filter((d) => {
      const b = d.entityType === 'vehicle' ? allV.get(d.entityId)?.branchId : allD.get(d.entityId)?.branchId
      return isAll || b === branchId
    })
  }, [allDocuments, allVehicles, allDrivers, isAll, branchId])
  const dailyStats = useMemo(
    () => scopeDailyStats(allDaily, { isAll, allVehicles, vehicles, allTrips, trips, fuel }),
    [allDaily, isAll, allVehicles, vehicles, allTrips, trips, fuel],
  )

  const inScopeEntity = useMemo(() => {
    if (isAll) return () => true
    const maps: Partial<Record<EntityRef['type'], Map<string, string>>> = {
      vehicle: new Map(allVehicles.map((x) => [x.id, x.branchId])),
      driver: new Map(allDrivers.map((x) => [x.id, x.branchId])),
      trip: new Map(allTrips.map((x) => [x.id, x.branchId])),
      workorder: new Map(allWorkOrders.map((x) => [x.id, x.branchId])),
      incident: new Map(allIncidents.map((x) => [x.id, x.branchId])),
      expense: new Map(allExpenses.map((x) => [x.id, x.branchId])),
      fuel: new Map(allFuel.map((x) => [x.id, x.branchId])),
      shipment: new Map(allShipments.map((x) => [x.id, x.branchId])),
      invoice: new Map(allInvoices.map((x) => [x.id, x.branchId])),
    }
    return (ref: EntityRef | null | undefined) => {
      if (!ref) return false
      if (ref.type === 'branch') return ref.id === branchId
      return maps[ref.type]?.get(ref.id) === branchId
    }
  }, [isAll, branchId, allVehicles, allDrivers, allTrips, allWorkOrders, allIncidents, allExpenses, allFuel, allShipments, allInvoices])

  const value = useMemo<DashScope>(
    () => ({
      range, trend, now, isAll, branchId, branchName: branch?.name ?? null,
      vehicles, drivers, trips, fuel, workOrders, expenses, incidents, safetyEvents, schedules, documents, dailyStats,
      vehicleById, driverById, inScopeEntity,
    }),
    [range, trend, now, isAll, branchId, branch, vehicles, drivers, trips, fuel, workOrders, expenses, incidents, safetyEvents, schedules, documents, dailyStats, vehicleById, driverById, inScopeEntity],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
