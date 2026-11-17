import { useMemo } from 'react'
import { useDb } from '@/store/db'

/**
 * Per-vehicle slices of the database. Every hook is reactive and memoised on the underlying collection,
 * so screens keep working while the GPS simulator mutates trips, fuel transactions and incidents.
 */
export function useVehicleTrips(id: string) {
  const all = useDb((s) => s.trips)
  return useMemo(() => all.filter((t) => t.vehicleId === id).sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)), [all, id])
}

export function useVehicleWorkOrders(id: string) {
  const all = useDb((s) => s.workOrders)
  return useMemo(() => all.filter((w) => w.vehicleId === id).sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate)), [all, id])
}

export function useVehicleSchedules(id: string) {
  const all = useDb((s) => s.schedules)
  return useMemo(() => all.filter((s) => s.vehicleId === id), [all, id])
}

export function useVehicleFuel(id: string) {
  const all = useDb((s) => s.fuelTransactions)
  return useMemo(() => all.filter((f) => f.vehicleId === id).sort((a, b) => a.date.localeCompare(b.date)), [all, id])
}

export function useVehicleExpenses(id: string) {
  const all = useDb((s) => s.expenses)
  return useMemo(() => all.filter((e) => e.vehicleId === id).sort((a, b) => b.date.localeCompare(a.date)), [all, id])
}

export function useVehicleDocuments(id: string) {
  const all = useDb((s) => s.documents)
  return useMemo(() => all.filter((d) => d.entityType === 'vehicle' && d.entityId === id), [all, id])
}

export function useVehicleIncidents(id: string) {
  const all = useDb((s) => s.incidents)
  return useMemo(() => all.filter((i) => i.vehicleId === id).sort((a, b) => b.date.localeCompare(a.date)), [all, id])
}

export function useVehicleSafetyEvents(id: string) {
  const all = useDb((s) => s.safetyEvents)
  return useMemo(() => all.filter((e) => e.vehicleId === id).sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [all, id])
}

export function useVehicleInspections(id: string) {
  const all = useDb((s) => s.inspections)
  return useMemo(() => all.filter((i) => i.vehicleId === id).sort((a, b) => b.date.localeCompare(a.date)), [all, id])
}
