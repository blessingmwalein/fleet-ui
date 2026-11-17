import { toast } from 'sonner'
import type { DocumentRecord, Driver } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { DOCUMENT_TYPE } from '@/config/status'
import { assignVehicle, deleteDrivers, deleteIssues, unassignIssues, type BulkResult } from './driverActions'

/** Confirm + release the driver's vehicle (both sides of the link). */
export async function unassignVehicleFlow(driver: Driver): Promise<boolean> {
  const blockers = unassignIssues(driver)
  if (blockers.length) {
    toast.error(blockers[0])
    return false
  }
  const vehicle = useDb.getState().vehicles.find((v) => v.id === driver.vehicleId)
  const ok = await confirm({
    title: `Unassign ${vehicle?.reg ?? 'vehicle'}?`,
    description: `${driver.name} will no longer be the registered driver of ${vehicle?.reg ?? 'this vehicle'}. Upcoming trips keep their current assignment until dispatch edits them.`,
    confirmLabel: 'Unassign vehicle',
  })
  if (!ok) return false
  assignVehicle(driver.id, null)
  toast.success(`${vehicle?.reg ?? 'Vehicle'} unassigned from ${driver.name}`)
  return true
}

/** Confirm + delete one or many drivers. Drivers on an active trip are blocked and reported. */
export async function deleteDriversFlow(drivers: Driver[]): Promise<BulkResult | null> {
  if (!drivers.length) return null
  const blocked = drivers.filter((d) => deleteIssues(d))
  const deletable = drivers.filter((d) => !deleteIssues(d))
  if (!deletable.length) {
    toast.error(blocked.length === 1 ? `${deleteIssues(blocked[0]!)} — complete or reassign the trip first.` : `${blocked.length} selected drivers are on active trips and cannot be deleted.`)
    return null
  }
  const single = deletable.length === 1 ? deletable[0]! : null
  const ok = await confirm({
    title: single ? `Delete ${single.name}?` : `Delete ${deletable.length} drivers?`,
    description:
      (single ? `${single.name} (${single.empNo}) will be removed from the roster` : `${deletable.length} drivers will be removed from the roster`) +
      ', their vehicles released, upcoming trips returned to the assignment queue and their documents deleted. Historical trips, safety events and incidents keep their records.' +
      (blocked.length ? ` ${blocked.length} driver${blocked.length === 1 ? '' : 's'} on an active trip will be skipped.` : ''),
    confirmLabel: single ? 'Delete driver' : `Delete ${deletable.length} drivers`,
    destructive: true,
  })
  if (!ok) return null
  const res = deleteDrivers(deletable.map((d) => d.id))
  if (res.done.length) toast.success(res.done.length === 1 ? `${res.done[0]} deleted` : `${res.done.length} drivers deleted`)
  if (res.skipped.length) toast.warning(`Skipped ${res.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`)
  return res
}

export async function removeDocumentFlow(doc: DocumentRecord): Promise<boolean> {
  const label = DOCUMENT_TYPE[doc.type] ?? doc.type
  const ok = await confirm({
    title: `Delete ${label.toLowerCase()}?`,
    description: `${doc.fileName} (${doc.number}) will be permanently removed from this driver's file. The compliance expiry date on the driver record is not changed.`,
    confirmLabel: 'Delete document',
    destructive: true,
  })
  if (!ok) return false
  useDb.getState().remove('documents', doc.id, { summary: `Deleted ${label.toLowerCase()} ${doc.number}` })
  toast.success(`${label} deleted`)
  return true
}
