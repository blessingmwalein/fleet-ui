import type { EntityRef, EntityType } from '@/types'
import { useUi } from '@/store/ui'

/** Lets non-React code (toasts, services) navigate. The app shell registers the router's navigate fn. */
let navigateFn: ((to: string) => void) | null = null
export function registerNavigate(fn: (to: string) => void) {
  navigateFn = fn
}
export function navigateTo(path: string) {
  if (navigateFn) navigateFn(path)
  else window.location.assign(path)
}

/**
 * Canonical URL for an entity detail view. Trips open the global drawer instead (see `openEntity`).
 * List pages that show an entity drawer honour the `?open=<id>` query parameter.
 */
export function entityPath(type: EntityType, id: string): string {
  switch (type) {
    case 'vehicle': return `/vehicles/${id}`
    case 'driver': return `/drivers/${id}`
    case 'trip': return `/dispatch?trip=${id}`
    case 'shipment': return `/shipments/${id}`
    case 'customer': return `/customers/${id}`
    case 'workorder': return `/maintenance/work-orders?open=${id}`
    case 'incident': return `/safety/incidents?open=${id}`
    case 'expense': return `/finance/expenses?open=${id}`
    case 'invoice': return `/finance/invoices?open=${id}`
    case 'fuel': return `/fuel/transactions?open=${id}`
    case 'branch': return `/admin/organisation?branch=${id}`
    case 'user': return `/admin/users?open=${id}`
    case 'document': return `/safety/compliance?open=${id}`
  }
}

export function openEntity(ref: EntityRef) {
  if (ref.type === 'trip') {
    useUi.getState().openTrip(ref.id)
    return
  }
  navigateTo(entityPath(ref.type, ref.id))
}
