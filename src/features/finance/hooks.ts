import { useMemo } from 'react'
import { useDb } from '@/store/db'
import { useBranchScope } from '@/hooks/useFilters'
import { useCurrentUser } from '@/hooks/useAuth'
import { buildCostEntries, buildCostLookup, buildRevenueEntries, withDerivedBranch } from './lib'

/** Operating-cost ledger (fuel + completed work orders + non-rejected expenses): `all` is unscoped, `scoped` honours the branch filter. */
export function useCosts() {
  const fuel = useDb((s) => s.fuelTransactions)
  const workOrders = useDb((s) => s.workOrders)
  const expenses = useDb((s) => s.expenses)
  const { scope } = useBranchScope()
  const all = useMemo(() => buildCostEntries(fuel, workOrders, expenses), [fuel, workOrders, expenses])
  const scoped = useMemo(() => scope(all), [all, scope])
  const lookup = useMemo(() => buildCostLookup(all), [all])
  return { all, scoped, lookup }
}

/** Revenue ledger (completed trips). */
export function useRevenue() {
  const trips = useDb((s) => s.trips)
  const { scope } = useBranchScope()
  const all = useMemo(() => buildRevenueEntries(trips), [trips])
  const scoped = useMemo(() => scope(all), [all, scope])
  return { all, scoped }
}

/** Invoices with customer-invoice branches derived from the trips they bill. */
export function useInvoices() {
  const invoices = useDb((s) => s.invoices)
  const trips = useDb((s) => s.trips)
  const { scope } = useBranchScope()
  const all = useMemo(() => {
    const byId = new Map(trips.map((t) => [t.id, t.branchId]))
    return withDerivedBranch(invoices, (id) => byId.get(id))
  }, [invoices, trips])
  const scoped = useMemo(() => scope(all), [all, scope])
  return { all, scoped }
}

/** Signed-in user's display name (used as approver / recorder). */
export function useActorName() {
  return useCurrentUser().user.name
}
