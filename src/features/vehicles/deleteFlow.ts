import { toast } from 'sonner'
import type { Vehicle } from '@/types'
import { confirm } from '@/store/confirm'
import { deleteVehicles, deletionImpact } from './actions'

/** Confirmation + delete for one or many vehicles. Vehicles on an active trip are blocked. Resolves to the deleted ids. */
export async function confirmAndDeleteVehicles(vehicles: Vehicle[]): Promise<string[]> {
  const ids = vehicles.map((v) => v.id)
  const impact = deletionImpact(ids)
  if (impact.blocked.length === ids.length) {
    toast.error(ids.length === 1 ? `${impact.blocked[0]!.reg} cannot be deleted` : 'None of the selected vehicles can be deleted', {
      description: `${impact.blocked.map((b) => `${b.reg} is on active trip ${b.trip}`).join('; ')}. Complete or cancel the trip first.`,
    })
    return []
  }
  const doomed = ids.length - impact.blocked.length
  const effects = [
    impact.documents ? `${impact.documents} document${impact.documents === 1 ? '' : 's'} and ${impact.schedules} service schedule${impact.schedules === 1 ? '' : 's'} will be removed` : '',
    impact.drivers ? `${impact.drivers} driver${impact.drivers === 1 ? '' : 's'} will be unassigned` : '',
    impact.upcomingTrips ? `${impact.upcomingTrips} upcoming trip${impact.upcomingTrips === 1 ? '' : 's'} will return to “Awaiting assignment”` : '',
  ].filter(Boolean)
  const name = vehicles.length === 1 ? vehicles[0]!.reg : `${doomed} vehicles`
  const ok = await confirm({
    title: `Delete ${name}?`,
    description: `${effects.length ? effects.join('; ') + '. ' : ''}Historical trips, fuel and expense records are kept.${impact.blocked.length ? ` ${impact.blocked.map((b) => b.reg).join(', ')} will be skipped (active trip).` : ''} This cannot be undone.`,
    confirmLabel: 'Delete vehicle' + (doomed === 1 ? '' : 's'),
    destructive: true,
  })
  if (!ok) return []
  const res = deleteVehicles(ids)
  toast.success(res.deleted.length === 1 ? `${name} deleted` : `${res.deleted.length} vehicles deleted`, {
    description: res.blocked.length ? `${res.blocked.length} skipped — on an active trip.` : undefined,
  })
  return res.deleted
}
