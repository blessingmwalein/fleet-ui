import { Link } from 'react-router-dom'
import type { EntityType } from '@/types'
import { useDb, type DbState } from '@/store/db'
import { useUi } from '@/store/ui'
import { entityPath } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/display'
import { Plate } from './Status'

const cache = new WeakMap<object, Map<string, { id: string }>>()
function find<T extends { id: string }>(list: T[], id: string): T | undefined {
  let m = cache.get(list)
  if (!m) {
    m = new Map(list.map((x) => [x.id, x]))
    cache.set(list, m)
  }
  return m.get(id) as T | undefined
}

/** Resolve a display label for any entity reference (used by links, notifications and search). */
export function labelFor(s: DbState, type: EntityType, id: string): string | null {
  switch (type) {
    case 'vehicle': return find(s.vehicles, id)?.reg ?? null
    case 'driver': return find(s.drivers, id)?.name ?? null
    case 'trip': return find(s.trips, id)?.ref ?? null
    case 'shipment': return find(s.shipments, id)?.trackingRef ?? null
    case 'customer': return find(s.customers, id)?.name ?? null
    case 'workorder': return find(s.workOrders, id)?.woNo ?? null
    case 'incident': return find(s.incidents, id)?.ref ?? null
    case 'expense': return find(s.expenses, id)?.ref ?? null
    case 'invoice': return find(s.invoices, id)?.number ?? null
    case 'fuel': return find(s.fuelTransactions, id)?.ref ?? null
    case 'branch': return find(s.branches, id)?.name ?? null
    case 'user': return find(s.users, id)?.name ?? null
    case 'document': return find(s.documents, id)?.number ?? null
  }
}

export function useEntityLabel(type: EntityType, id: string | null | undefined) {
  return useDb((s) => (id ? labelFor(s, type, id) : null))
}

/**
 * Link to any entity's detail view, labelled from the live database.
 *   <EntityLink type="vehicle" id={trip.vehicleId} />
 * Trips open the global trip drawer; everything else navigates.
 */
export function EntityLink({ type, id, children, className, avatar, fallback = '—' }: { type: EntityType; id: string | null | undefined; children?: React.ReactNode; className?: string; avatar?: boolean; fallback?: string }) {
  const label = useEntityLabel(type, id)
  const openTrip = useUi((s) => s.openTrip)
  if (!id || !label) return <span className="text-subtle-foreground">{fallback}</span>
  const content = children ?? (type === 'vehicle' ? <Plate>{label}</Plate> : label)
  const cls = cn('inline-flex max-w-full items-center gap-1.5 truncate text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline', className)
  const inner = (
    <>
      {avatar && (type === 'driver' || type === 'user') && <Avatar name={label} size={20} />}
      <span className="truncate">{content}</span>
    </>
  )
  if (type === 'trip') {
    return (
      <button type="button" className={cls} onClick={(e) => { e.stopPropagation(); openTrip(id) }}>
        {inner}
      </button>
    )
  }
  return (
    <Link to={entityPath(type, id)} className={cls} onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  )
}

export const VehicleLink = (p: { id: string | null | undefined; className?: string }) => <EntityLink type="vehicle" {...p} />
export const DriverLink = (p: { id: string | null | undefined; className?: string; avatar?: boolean; fallback?: string }) => <EntityLink type="driver" {...p} />
export const TripLink = (p: { id: string | null | undefined; className?: string }) => <EntityLink type="trip" {...p} />
export const CustomerLink = (p: { id: string | null | undefined; className?: string }) => <EntityLink type="customer" {...p} />
export const ShipmentLink = (p: { id: string | null | undefined; className?: string }) => <EntityLink type="shipment" {...p} />
export const BranchLink = (p: { id: string | null | undefined; className?: string }) => <EntityLink type="branch" {...p} />
