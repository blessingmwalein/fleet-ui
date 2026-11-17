import { toast } from 'sonner'
import type { Inspection, PartUsage, ServiceProvider, ServiceSchedule, Vehicle, WorkOrder, WorkOrderType } from '@/types'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import { getById } from '@/hooks/useLookup'
import { fmtDate } from '@/lib/format'
import { appendNote, computeNextDue, nextInspectionRef, nextWoNo, partsTotal } from './maintenance'

const db = () => useDb.getState()

export function currentUserName() {
  const id = useSession.getState().userId
  return db().users.find((u) => u.id === id)?.name ?? 'System'
}

// ---------------------------------------------------------------------------
// Vehicle workshop status
// ---------------------------------------------------------------------------
/** Puts the vehicle into the workshop (the GPS simulator parks it at the depot while status = maintenance). */
function takeIntoWorkshop(vehicle: Vehicle, woNo: string) {
  if (vehicle.status === 'maintenance') return
  db().update('vehicles', vehicle.id, { status: 'maintenance' }, { action: 'status', summary: `${vehicle.reg} taken into workshop (${woNo})` })
}

/** Returns the vehicle to service when no other work order keeps it in the workshop. */
function releaseVehicle(vehicleId: string, exceptWoId: string, why: string, patch: Partial<Vehicle> = {}) {
  const v = getById('vehicles', vehicleId)
  if (!v) return false
  const stillBusy = db().workOrders.some((w) => w.vehicleId === vehicleId && w.status === 'in_progress' && w.id !== exceptWoId)
  if (v.status === 'maintenance' && !stillBusy) {
    db().update('vehicles', v.id, { ...patch, status: 'active' }, { action: 'status', summary: `${v.reg} returned to service (${why})` })
    return true
  }
  if (Object.keys(patch).length) db().update('vehicles', v.id, patch, { silent: true })
  return false
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------
export interface NewWorkOrderInput {
  vehicleId: string
  type: WorkOrderType
  title: string
  description?: string
  priority: WorkOrder['priority']
  providerId: string
  technician?: string
  scheduledDate: string
  status?: 'requested' | 'scheduled'
  notes?: string
}

export function createWorkOrder(input: NewWorkOrderInput, quiet = false): WorkOrder {
  const v = getById('vehicles', input.vehicleId)
  if (!v) throw new Error('Vehicle not found')
  const woNo = nextWoNo(db().workOrders)
  const status = input.status ?? 'requested'
  const wo = db().insert(
    'workOrders',
    {
      woNo,
      vehicleId: v.id,
      branchId: v.branchId,
      type: input.type,
      title: input.title,
      description: input.description ?? '',
      priority: input.priority,
      status,
      providerId: input.providerId,
      requestedBy: currentUserName(),
      technician: input.technician ?? '',
      requestedAt: new Date().toISOString(),
      scheduledDate: input.scheduledDate,
      startedAt: null,
      completedAt: null,
      odometerKm: v.odometerKm,
      downtimeHours: 0,
      labourCostUsd: 0,
      partsCostUsd: 0,
      parts: [],
      notes: input.notes,
    },
    { summary: status === 'scheduled' ? `Scheduled work order ${woNo} for ${v.reg}: ${input.title}` : `Requested maintenance ${woNo} for ${v.reg}: ${input.title}` },
  )
  if (!quiet) toast.success(status === 'scheduled' ? `${woNo} scheduled for ${fmtDate(input.scheduledDate)}` : `${woNo} requested`, { description: `${v.reg} · ${input.title}` })
  return wo
}

export function updateWorkOrderDetails(wo: WorkOrder, patch: Partial<WorkOrder>) {
  db().update('workOrders', wo.id, patch, { summary: `Updated work order ${wo.woNo}` })
  toast.success(`${wo.woNo} updated`)
}

export function approveWorkOrders(list: WorkOrder[]) {
  const eligible = list.filter((w) => w.status === 'requested')
  for (const w of eligible) db().update('workOrders', w.id, { status: 'approved' }, { action: 'approve', summary: `Approved work order ${w.woNo}` })
  if (!eligible.length) toast.info('No requested work orders in the selection')
  else toast.success(eligible.length === 1 ? `${eligible[0]!.woNo} approved` : `${eligible.length} work orders approved`)
  return eligible.length
}

export function rejectWorkOrder(wo: WorkOrder, reason: string) {
  db().update('workOrders', wo.id, { status: 'cancelled', notes: appendNote(wo.notes, `Rejected: ${reason}`) }, { action: 'status', summary: `Rejected maintenance request ${wo.woNo}: ${reason}` })
  toast.success(`${wo.woNo} rejected`)
}

export function cancelWorkOrder(wo: WorkOrder, reason: string, quiet = false) {
  db().update('workOrders', wo.id, { status: 'cancelled', notes: appendNote(wo.notes, `Cancelled: ${reason}`) }, { action: 'status', summary: `Cancelled work order ${wo.woNo}: ${reason}` })
  if (wo.status === 'in_progress') releaseVehicle(wo.vehicleId, wo.id, `${wo.woNo} cancelled`)
  if (!quiet) toast.success(`${wo.woNo} cancelled`)
}

export function cancelWorkOrders(list: WorkOrder[], reason: string) {
  const eligible = list.filter((w) => w.status !== 'completed' && w.status !== 'cancelled')
  for (const w of eligible) cancelWorkOrder(w, reason, true)
  return eligible.length
}

export function reopenWorkOrder(wo: WorkOrder) {
  db().update('workOrders', wo.id, { status: 'requested' }, { action: 'status', summary: `Reopened work order ${wo.woNo}` })
  toast.success(`${wo.woNo} reopened as a request`)
}

export function scheduleWorkOrder(wo: WorkOrder, v: { scheduledDate: string; providerId: string; technician?: string }) {
  const resched = wo.status === 'scheduled'
  db().update(
    'workOrders',
    wo.id,
    { status: 'scheduled', scheduledDate: v.scheduledDate, providerId: v.providerId, technician: v.technician ?? wo.technician },
    { action: 'status', summary: `${resched ? 'Rescheduled' : 'Scheduled'} work order ${wo.woNo} for ${fmtDate(v.scheduledDate)}` },
  )
  toast.success(`${wo.woNo} ${resched ? 'rescheduled' : 'scheduled'} for ${fmtDate(v.scheduledDate)}`)
}

export function startWorkOrder(wo: WorkOrder, v: { technician: string; odometerKm: number; note?: string }) {
  const now = new Date().toISOString()
  db().update(
    'workOrders',
    wo.id,
    { status: 'in_progress', startedAt: now, technician: v.technician, odometerKm: v.odometerKm, notes: v.note ? appendNote(wo.notes, v.note) : wo.notes },
    { action: 'status', summary: `Started work order ${wo.woNo}` },
  )
  const veh = getById('vehicles', wo.vehicleId)
  if (veh) takeIntoWorkshop(veh, wo.woNo)
  toast.success(`${wo.woNo} started`, { description: veh ? `${veh.reg} is now in the workshop` : undefined })
}

export interface CostInput {
  labourCostUsd: number
  parts: PartUsage[]
  downtimeHours: number
  odometerKm: number
  notes?: string
}

/** Save parts / labour on an in-progress job without completing it. */
export function saveWorkOrderProgress(wo: WorkOrder, v: CostInput) {
  db().update(
    'workOrders',
    wo.id,
    { labourCostUsd: v.labourCostUsd, parts: v.parts, partsCostUsd: partsTotal(v.parts), downtimeHours: v.downtimeHours, odometerKm: v.odometerKm, notes: v.notes ? appendNote(wo.notes, v.notes) : wo.notes },
    { summary: `Updated parts & costs on ${wo.woNo}` },
  )
  toast.success(`${wo.woNo} costs saved`)
}

export interface FollowUpInput {
  task: string
  intervalKm: number | null
  intervalDays: number | null
  estCostUsd: number
}

export function completeWorkOrder(wo: WorkOrder, v: CostInput & { completedAt: string; serviceIds: string[]; followUp?: FollowUpInput | null }) {
  const partsCostUsd = partsTotal(v.parts)
  db().update(
    'workOrders',
    wo.id,
    {
      status: 'completed',
      completedAt: v.completedAt,
      startedAt: wo.startedAt ?? v.completedAt,
      labourCostUsd: v.labourCostUsd,
      parts: v.parts,
      partsCostUsd,
      downtimeHours: v.downtimeHours,
      odometerKm: v.odometerKm,
      notes: v.notes ? appendNote(wo.notes, `Completion: ${v.notes}`) : wo.notes,
    },
    { action: 'status', summary: `Completed work order ${wo.woNo} (${wo.title})` },
  )

  const veh = getById('vehicles', wo.vehicleId)
  if (veh) releaseVehicle(veh.id, wo.id, `${wo.woNo} completed`, v.odometerKm > veh.odometerKm ? { odometerKm: v.odometerKm } : {})

  const doneAt = new Date(v.completedAt)
  let updatedSchedules = 0
  for (const id of v.serviceIds) {
    const s = getById('schedules', id)
    if (!s) continue
    const next = computeNextDue(s.intervalKm, s.intervalDays, doneAt, v.odometerKm)
    db().update('schedules', s.id, { lastServiceDate: v.completedAt, lastServiceKm: v.odometerKm, ...next }, { summary: `Service schedule "${s.task}" reset after ${wo.woNo}` })
    updatedSchedules += 1
  }
  let created = false
  if (v.followUp) {
    const next = computeNextDue(v.followUp.intervalKm, v.followUp.intervalDays, doneAt, v.odometerKm)
    db().insert(
      'schedules',
      { vehicleId: wo.vehicleId, task: v.followUp.task, intervalKm: v.followUp.intervalKm, intervalDays: v.followUp.intervalDays, lastServiceDate: v.completedAt, lastServiceKm: v.odometerKm, ...next, estCostUsd: v.followUp.estCostUsd },
      { summary: `Created service schedule "${v.followUp.task}" for ${veh?.reg ?? wo.vehicleId}` },
    )
    created = true
  }
  const extra = [updatedSchedules ? `${updatedSchedules} schedule${updatedSchedules > 1 ? 's' : ''} reset` : '', created ? 'follow-up schedule created' : ''].filter(Boolean).join(' · ')
  toast.success(`${wo.woNo} completed`, { description: extra || (veh ? `${veh.reg} returned to service` : undefined) })
}

export function deleteWorkOrders(list: WorkOrder[]) {
  for (const w of list) {
    if (w.status === 'in_progress') releaseVehicle(w.vehicleId, w.id, `${w.woNo} deleted`)
  }
  if (list.length === 1) db().remove('workOrders', list[0]!.id)
  else db().removeMany('workOrders', list.map((w) => w.id))
  toast.success(list.length === 1 ? `${list[0]!.woNo} deleted` : `${list.length} work orders deleted`)
}

// ---------------------------------------------------------------------------
// Service schedules
// ---------------------------------------------------------------------------
export interface ScheduleInput {
  vehicleId: string
  task: string
  intervalKm: number | null
  intervalDays: number | null
  lastServiceDate: string
  lastServiceKm: number
  estCostUsd: number
}

export function saveSchedule(existing: ServiceSchedule | null, v: ScheduleInput) {
  const next = computeNextDue(v.intervalKm, v.intervalDays, new Date(v.lastServiceDate), v.lastServiceKm)
  const reg = getById('vehicles', v.vehicleId)?.reg ?? v.vehicleId
  if (existing) {
    db().update('schedules', existing.id, { ...v, ...next }, { summary: `Updated service schedule "${v.task}" for ${reg}` })
    toast.success('Service schedule updated')
  } else {
    db().insert('schedules', { ...v, ...next }, { summary: `Created service schedule "${v.task}" for ${reg}` })
    toast.success('Service schedule created', { description: `${reg} · ${v.task}` })
  }
}

export function markServiced(s: ServiceSchedule, v: { date: string; odometerKm: number }) {
  const next = computeNextDue(s.intervalKm, s.intervalDays, new Date(v.date), v.odometerKm)
  const reg = getById('vehicles', s.vehicleId)?.reg ?? s.vehicleId
  db().update('schedules', s.id, { lastServiceDate: v.date, lastServiceKm: v.odometerKm, ...next }, { summary: `Marked "${s.task}" serviced for ${reg}` })
  toast.success(`${s.task} marked as serviced`, { description: `${reg} · next due ${fmtDate(next.nextDueDate)}` })
}

export function deleteSchedules(list: ServiceSchedule[]) {
  if (list.length === 1) db().remove('schedules', list[0]!.id)
  else db().removeMany('schedules', list.map((s) => s.id))
  toast.success(list.length === 1 ? 'Service schedule deleted' : `${list.length} service schedules deleted`)
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------
export function createInspection(v: Omit<Inspection, 'id' | 'ref'>): Inspection {
  const ref = nextInspectionRef(db().inspections)
  const reg = getById('vehicles', v.vehicleId)?.reg ?? v.vehicleId
  const ins = db().insert('inspections', { ...v, ref }, { summary: `Recorded ${v.result} inspection ${ref} for ${reg}` })
  toast.success(`${ref} recorded`, { description: `${reg} · ${v.result === 'pass' ? 'Passed' : v.result === 'fail' ? 'Failed' : 'Conditional'}` })
  return ins
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
export function saveProvider(existing: ServiceProvider | null, v: Omit<ServiceProvider, 'id'>) {
  if (existing) {
    db().update('providers', existing.id, v, { summary: `Updated service provider ${v.name}` })
    toast.success(`${v.name} updated`)
  } else {
    db().insert('providers', v, { summary: `Added service provider ${v.name}` })
    toast.success(`${v.name} added to the provider directory`)
  }
}
