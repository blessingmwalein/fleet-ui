import { toast } from 'sonner'
import type { Customer } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'

export const CUSTOMER_STATUS: Record<Customer['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
  inactive: { label: 'Inactive', tone: 'neutral' },
}

/** Place a customer on credit hold / release it (with confirmation when holding). */
export async function toggleHold(c: Customer): Promise<boolean> {
  const hold = c.status === 'active'
  if (hold) {
    const ok = await confirm({
      title: `Place ${c.name} on hold?`,
      description: 'New shipments cannot be registered for this customer until the hold is released. Existing shipments are not affected.',
      confirmLabel: 'Place on hold',
      destructive: true,
    })
    if (!ok) return false
  }
  useDb.getState().update('customers', c.id, { status: hold ? 'on_hold' : 'active' }, { action: 'status', summary: `${hold ? 'Placed on hold' : 'Released hold on'} customer ${c.name}` })
  toast.success(hold ? `${c.name} placed on hold` : `${c.name} reactivated`)
  return true
}

export function customerDependencies(c: Customer) {
  const s = useDb.getState()
  return {
    shipments: s.shipments.filter((x) => x.customerId === c.id).length,
    trips: s.trips.filter((x) => x.customerId === c.id).length,
    invoices: s.invoices.filter((x) => x.partyId === c.id).length,
  }
}

/** Delete a customer. Customers with history can't be deleted — deactivate them instead. */
export async function deleteCustomer(c: Customer): Promise<boolean> {
  const dep = customerDependencies(c)
  if (dep.shipments || dep.trips || dep.invoices) {
    toast.error(`${c.name} has history and can't be deleted`, { description: `${dep.shipments} shipments, ${dep.trips} trips, ${dep.invoices} invoices. Set the account to Inactive instead.` })
    return false
  }
  const ok = await confirm({ title: `Delete ${c.name}?`, description: 'This permanently removes the customer account. This cannot be undone.', confirmLabel: 'Delete customer', destructive: true })
  if (!ok) return false
  useDb.getState().remove('customers', c.id, { summary: `Deleted customer ${c.name}` })
  toast.success(`${c.name} deleted`)
  return true
}
