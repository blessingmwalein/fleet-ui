import { useMemo } from 'react'
import { useDb } from '@/store/db'
import { invoiceBalance } from './shipmentLib'

export interface CustomerStats {
  shipments: number
  activeShipments: number
  delivered: number
  exceptions: number
  trips: number
  revenue90: number
  revenuePrev90: number
  outstanding: number
  overdue: number
  openInvoices: number
  /** share of completed trips (last 180 days) that finished within 20 min of plan; null when no history */
  onTimePct: number | null
  /** outstanding balance as % of credit limit */
  utilisationPct: number
  lastShipmentAt: string | null
}

const DAY = 864e5
export const ON_TIME_GRACE_MIN = 20

const EMPTY: CustomerStats = {
  shipments: 0, activeShipments: 0, delivered: 0, exceptions: 0, trips: 0, revenue90: 0, revenuePrev90: 0, outstanding: 0, overdue: 0, openInvoices: 0, onTimePct: null, utilisationPct: 0, lastShipmentAt: null,
}

/** Per-customer commercial rollups (shipments, revenue, receivables, on-time rate). Recomputed when the underlying collections change. */
export function useCustomerStats() {
  const customers = useDb((s) => s.customers)
  const shipments = useDb((s) => s.shipments)
  const trips = useDb((s) => s.trips)
  const invoices = useDb((s) => s.invoices)

  return useMemo(() => {
    const now = Date.now()
    const map = new Map<string, CustomerStats & { _onTime: number; _done: number }>()
    const get = (id: string) => {
      let s = map.get(id)
      if (!s) {
        s = { ...EMPTY, _onTime: 0, _done: 0 }
        map.set(id, s)
      }
      return s
    }
    for (const s of shipments) {
      const c = get(s.customerId)
      c.shipments++
      if (s.status === 'delivered') c.delivered++
      else c.activeShipments++
      if (s.exception && !s.exception.resolved) c.exceptions++
      if (!c.lastShipmentAt || s.createdAt > c.lastShipmentAt) c.lastShipmentAt = s.createdAt
    }
    for (const t of trips) {
      if (!t.customerId) continue
      const c = get(t.customerId)
      c.trips++
      if (t.status !== 'completed' || !t.actualEnd) continue
      const age = (now - new Date(t.actualEnd).getTime()) / DAY
      if (age <= 90) c.revenue90 += t.revenueUsd
      else if (age <= 180) c.revenuePrev90 += t.revenueUsd
      if (age <= 180) {
        c._done++
        if (t.delayMinutes <= ON_TIME_GRACE_MIN) c._onTime++
      }
    }
    for (const i of invoices) {
      if (i.kind !== 'customer' || !i.partyId) continue
      const bal = invoiceBalance(i)
      if (!bal) continue
      const c = get(i.partyId)
      c.outstanding += bal
      c.openInvoices++
      if (i.status === 'overdue') c.overdue += bal
    }
    const out = new Map<string, CustomerStats>()
    for (const cu of customers) {
      const c = map.get(cu.id) ?? { ...EMPTY, _onTime: 0, _done: 0 }
      out.set(cu.id, {
        shipments: c.shipments, activeShipments: c.activeShipments, delivered: c.delivered, exceptions: c.exceptions, trips: c.trips,
        revenue90: c.revenue90, revenuePrev90: c.revenuePrev90, outstanding: c.outstanding, overdue: c.overdue, openInvoices: c.openInvoices,
        onTimePct: c._done ? (c._onTime / c._done) * 100 : null,
        utilisationPct: cu.creditLimitUsd > 0 ? (c.outstanding / cu.creditLimitUsd) * 100 : 0,
        lastShipmentAt: c.lastShipmentAt,
      })
    }
    return out
  }, [customers, shipments, trips, invoices])
}

export { EMPTY as EMPTY_CUSTOMER_STATS }
