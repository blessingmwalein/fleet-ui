import { create } from 'zustand'
import { toast } from 'sonner'
import type { CargoType, ID, Trip, TripStatus } from '@/types'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { confirm } from '@/store/confirm'
import { can } from '@/hooks/useAuth'
import { TRIP_STATUS } from '@/config/status'
import { clearDelay, deleteTrips, getTrip, isDraft, isTerminal, reinstateTrip, setTripStage, unassignTrip } from './tripLogic'

/* -------------------------------------------------------------------------------------------------
 * Dialog orchestration for the dispatch workflow. One global store drives every trip dialog (form, assign,
 * dispatch, delay, complete, cancel) so the board, the trips table, the detail drawer and other modules
 * can all trigger them. The dialogs themselves live in TripDialogs.tsx and are mounted by TripDrawerHost.
 * ------------------------------------------------------------------------------------------------- */

export interface TripFormDefaults {
  customerId?: ID
  routeId?: string
  vehicleId?: ID
  driverId?: ID
  cargoType?: CargoType
  cargoDescription?: string
  cargoWeightKg?: number
  priority?: Trip['priority']
  scheduledStart?: string
  notes?: string
}

export type TripDialog =
  | { kind: 'form'; tripId?: ID; defaults?: TripFormDefaults }
  | { kind: 'assign'; tripIds: ID[]; then?: 'ready' | 'scheduled' | 'dispatch' }
  | { kind: 'dispatch'; tripId: ID }
  | { kind: 'delay'; tripId: ID }
  | { kind: 'complete'; tripId: ID }
  | { kind: 'cancel'; tripIds: ID[] }

interface TripDialogStore {
  dialog: TripDialog | null
  open: (d: TripDialog) => void
  close: () => void
  /** Close only when the given dialog kind is still the active one (a dialog may hand over to the next). */
  closeIf: (kind: TripDialog['kind']) => void
}

export const useTripDialogs = create<TripDialogStore>()((set, get) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
  closeIf: (kind) => {
    if (get().dialog?.kind === kind) set({ dialog: null })
  },
}))

const open = (d: TripDialog) => useTripDialogs.getState().open(d)

export const openTripForm = (opts?: { tripId?: ID; defaults?: TripFormDefaults }) => {
  if (!can(opts?.tripId ? 'dispatch.edit' : 'dispatch.create')) return denied()
  open({ kind: 'form', ...opts })
}
export const openAssign = (tripIds: ID[], then?: 'ready' | 'scheduled' | 'dispatch') => {
  if (!can('dispatch.edit')) return denied()
  open({ kind: 'assign', tripIds, then })
}
export const openDelay = (tripId: ID) => (can('dispatch.edit') ? open({ kind: 'delay', tripId }) : denied())
export const openComplete = (tripId: ID) => (can('dispatch.edit') ? open({ kind: 'complete', tripId }) : denied())
export const openCancel = (tripIds: ID[]) => (can('dispatch.edit') ? open({ kind: 'cancel', tripIds }) : denied())

function denied() {
  toast.error('Permission required', { description: 'Your role cannot modify trips. Switch role from the user menu to try this.' })
}

/* ----------------------------------------------------------------------------------------------- *
 * Status transitions (drag & drop, menus and drawer buttons all go through here)
 * ----------------------------------------------------------------------------------------------- */
export type Transition =
  | { mode: 'same' }
  | { mode: 'blocked'; reason: string }
  | { mode: 'direct'; label: string }
  | { mode: 'dialog'; label: string }

export function planTransition(trip: Trip, to: TripStatus): Transition {
  const from = trip.status
  if (from === to) return { mode: 'same' }
  const crew = !!trip.vehicleId && !!trip.driverId
  const blocked = (reason: string): Transition => ({ mode: 'blocked', reason })
  if (from === 'completed') return blocked('Completed trips are locked. Open the trip to correct revenue, notes or proof of delivery.')
  switch (to) {
    case 'awaiting_assignment':
      if (from === 'scheduled' || from === 'ready') return { mode: 'dialog', label: 'Unassign vehicle & driver' }
      if (from === 'cancelled') return { mode: 'dialog', label: 'Reinstate' }
      return blocked('A trip that is already under way cannot return to the assignment queue. Complete or cancel it instead.')
    case 'scheduled':
      if (from === 'ready') return { mode: 'direct', label: 'Back to scheduled' }
      if (from === 'awaiting_assignment') return crew ? { mode: 'direct', label: 'Schedule' } : { mode: 'dialog', label: 'Assign vehicle & driver' }
      if (from === 'cancelled') return { mode: 'dialog', label: 'Reinstate' }
      return blocked('A trip that is already under way cannot be rescheduled. Complete or cancel it instead.')
    case 'ready':
      if (from === 'scheduled') return crew ? { mode: 'direct', label: 'Mark ready' } : { mode: 'dialog', label: 'Assign vehicle & driver' }
      if (from === 'awaiting_assignment') return { mode: 'dialog', label: 'Assign vehicle & driver' }
      if (from === 'cancelled') return { mode: 'dialog', label: 'Reinstate' }
      return blocked('A trip that is already under way cannot return to ready. Complete or cancel it instead.')
    case 'in_transit':
      if (from === 'delayed') return { mode: 'direct', label: 'Clear delay' }
      if (from === 'cancelled') return blocked('Reinstate the cancelled trip first, then dispatch it.')
      return { mode: 'dialog', label: crew ? 'Dispatch' : 'Assign & dispatch' }
    case 'delayed':
      if (from === 'in_transit') return { mode: 'dialog', label: 'Report delay' }
      return blocked('Only trips that are in transit can be marked delayed. Dispatch the trip first.')
    case 'completed':
      if (from === 'in_transit' || from === 'delayed') return { mode: 'dialog', label: 'Capture proof of delivery' }
      return blocked('Only trips that are in transit can be completed. Dispatch the trip first.')
    case 'cancelled':
      return { mode: 'dialog', label: 'Cancel trip' }
  }
}

/** Request a status change; validates, opens the relevant dialog or applies the change. */
export async function requestStatus(tripId: ID, to: TripStatus) {
  const trip = getTrip(tripId)
  if (!trip) return
  const plan = planTransition(trip, to)
  if (plan.mode === 'same') return
  if (!can('dispatch.edit')) return denied()
  if (plan.mode === 'blocked') {
    toast.error(`${trip.ref} cannot move to ${TRIP_STATUS[to].label}`, { description: plan.reason })
    return
  }
  const crew = !!trip.vehicleId && !!trip.driverId
  const from = trip.status

  switch (to) {
    case 'awaiting_assignment': {
      if (from === 'cancelled') {
        if (await confirm({ title: `Reinstate ${trip.ref}?`, description: 'The trip returns to the assignment queue and can be scheduled again.', confirmLabel: 'Reinstate' })) {
          reinstateTrip(tripId, 'awaiting_assignment')
          toast.success(`${trip.ref} reinstated`, { description: 'Back in Awaiting assignment.' })
        }
        return
      }
      if (await confirm({ title: `Unassign ${trip.ref}?`, description: 'The vehicle and driver are released and the trip returns to Awaiting assignment.', confirmLabel: 'Unassign' })) {
        unassignTrip(tripId)
        toast.success(`${trip.ref} returned to the assignment queue`)
      }
      return
    }
    case 'scheduled':
    case 'ready': {
      if (from === 'cancelled') {
        if (!(await confirm({ title: `Reinstate ${trip.ref}?`, description: crew ? `The trip will be reinstated as ${TRIP_STATUS[to].label.toLowerCase()}.` : 'The trip is reinstated and you can assign a vehicle and driver next.', confirmLabel: 'Reinstate' }))) return
        if (crew) {
          reinstateTrip(tripId, to)
          toast.success(`${trip.ref} reinstated`, { description: TRIP_STATUS[to].label })
        } else {
          reinstateTrip(tripId, 'awaiting_assignment')
          toast.success(`${trip.ref} reinstated`, { description: 'Assign a vehicle and driver to continue.' })
          openAssign([tripId], to)
        }
        return
      }
      if (!crew) {
        openAssign([tripId], to)
        return
      }
      if (from === 'awaiting_assignment') {
        // crew already present (e.g. only the status was stale): just advance
        setTripStage(tripId, to)
      } else {
        setTripStage(tripId, to)
      }
      toast.success(to === 'ready' ? `${trip.ref} is ready for dispatch` : `${trip.ref} moved back to scheduled`)
      return
    }
    case 'in_transit': {
      if (from === 'delayed') {
        clearDelay(tripId)
        toast.success(`Delay cleared on ${trip.ref}`, { description: 'The trip is back in transit.' })
        return
      }
      if (!crew) {
        openAssign([tripId], 'dispatch')
        return
      }
      open({ kind: 'dispatch', tripId })
      return
    }
    case 'delayed':
      open({ kind: 'delay', tripId })
      return
    case 'completed':
      open({ kind: 'complete', tripId })
      return
    case 'cancelled':
      open({ kind: 'cancel', tripIds: [tripId] })
      return
  }
}

/** Delete draft trips after confirmation. Closes the drawer if it shows a deleted trip. */
export async function requestDelete(tripIds: ID[]) {
  if (!can('dispatch.delete')) return denied()
  const trips = useDb.getState().trips.filter((t) => tripIds.includes(t.id))
  const drafts = trips.filter((t) => isDraft(t.status))
  const skipped = trips.length - drafts.length
  if (!drafts.length) {
    toast.error('Only draft trips can be deleted', { description: 'Trips that are in transit, completed or cancelled are kept for the audit trail. Cancel them instead.' })
    return
  }
  const names = drafts.length === 1 ? drafts[0]!.ref : `${drafts.length} trips`
  const ok = await confirm({
    title: `Delete ${names}?`,
    description: `This permanently removes ${drafts.length === 1 ? 'the trip' : 'the trips'} and unlinks any shipment.${skipped ? ` ${skipped} selected trip${skipped === 1 ? ' is' : 's are'} not a draft and will be skipped.` : ''}`,
    confirmLabel: 'Delete',
    destructive: true,
  })
  if (!ok) return
  const n = deleteTrips(drafts.map((t) => t.id))
  if (drafts.some((t) => t.id === useUi.getState().tripDrawerId)) useUi.getState().openTrip(null)
  toast.success(n === 1 ? `Deleted ${drafts[0]!.ref}` : `Deleted ${n} trips`)
}

export const canCancelStatus = (s: TripStatus) => !isTerminal(s)
