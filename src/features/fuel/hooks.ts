import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { enrichFuel, type FuelRow } from './lib'

/** Every fuel transaction (all time, all branches) enriched with lookups and consumption analytics. */
export function useFuelRows(): FuelRow[] {
  const txs = useDb((s) => s.fuelTransactions)
  const vehicles = useDb((s) => s.vehicles)
  const stations = useDb((s) => s.fuelStations)
  const drivers = useDb((s) => s.drivers)
  const cards = useDb((s) => s.fuelCards)
  const branches = useDb((s) => s.branches)
  return useMemo(() => enrichFuel(txs, { vehicles, stations, drivers, cards, branches }), [txs, vehicles, stations, drivers, cards, branches])
}

/** RBAC flags used across the fuel pages. */
export function useFuelPerms() {
  const create = useCan('fuel.create')
  const edit = useCan('fuel.edit')
  const approve = useCan('fuel.approve')
  const del = useCan('fuel.delete')
  const exp = useCan('fuel.export')
  return {
    canCreate: create,
    canEdit: edit,
    /** mark reconciled / review & dismiss flags */
    canReview: edit || approve,
    canDelete: del,
    canExport: exp,
    /** add stations / issue cards */
    canManage: create || edit,
  }
}

/**
 * `?new=1` deep link: calls `open()` once (when allowed) and strips the param so a refresh doesn't re-open it.
 */
export function useNewParam(open: () => void, allowed = true) {
  const [params, setParams] = useSearchParams()
  const flag = params.get('new')
  useEffect(() => {
    if (flag !== '1') return
    if (allowed) open()
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag])
}
