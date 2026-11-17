import { useMemo } from 'react'
import type { ComboOption } from '@/components/ui/command'
import { useDb } from '@/store/db'
import { VEHICLE_CATEGORY } from '@/config/status'

/** Option lists for entity pickers (Combobox / SelectField). Memoised on the underlying collection. */
export function useVehicleOptions(filter?: (v: { status: string; driverId: string | null }) => boolean): ComboOption[] {
  const vehicles = useDb((s) => s.vehicles)
  return useMemo(
    () => vehicles.filter((v) => (filter ? filter(v) : true)).map((v) => ({ value: v.id, label: v.reg, hint: `${v.make} ${v.model}` })).sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles],
  )
}

export function useDriverOptions(): ComboOption[] {
  const drivers = useDb((s) => s.drivers)
  return useMemo(() => drivers.map((d) => ({ value: d.id, label: d.name, hint: d.empNo })).sort((a, b) => a.label.localeCompare(b.label)), [drivers])
}

export function useCustomerOptions(): ComboOption[] {
  const customers = useDb((s) => s.customers)
  return useMemo(() => customers.map((c) => ({ value: c.id, label: c.name, hint: c.city })).sort((a, b) => a.label.localeCompare(b.label)), [customers])
}

export function useBranchOptions(): ComboOption[] {
  const branches = useDb((s) => s.branches)
  return useMemo(() => branches.map((b) => ({ value: b.id, label: b.name, hint: b.city })), [branches])
}

export function useProviderOptions(): ComboOption[] {
  const providers = useDb((s) => s.providers)
  return useMemo(() => providers.map((p) => ({ value: p.id, label: p.name, hint: p.city })), [providers])
}

export const CATEGORY_OPTIONS = Object.entries(VEHICLE_CATEGORY).map(([value, label]) => ({ value, label }))
