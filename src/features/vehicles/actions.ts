import type { DocumentRecord, DocumentType, FuelType, Trip, Vehicle, VehicleCategory, VehicleStatus, WorkOrder, WorkOrderType } from '@/types'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import { VEHICLE_STATUS } from '@/config/status'
import { fromInputDate } from '@/components/forms/fields'
import { normaliseReg } from './lib'

/**
 * Vehicle domain actions. Pure store mutations (no UI) so every screen — list, detail, bulk actions — behaves identically.
 * Every function writes audit entries through `useDb` and keeps cross-entity links (driver ⇄ vehicle) consistent.
 */
const db = () => useDb.getState()
const currentUserName = () => db().users.find((u) => u.id === useSession.getState().userId)?.name ?? 'System'

export const isActiveTrip = (t: Trip) => t.status === 'in_transit' || t.status === 'delayed'
/** The trip a vehicle is currently on (in transit or delayed), read non-reactively. */
export const activeTripOf = (vehicleId: string) => db().trips.find((t) => t.vehicleId === vehicleId && isActiveTrip(t))

const jitter = () => (Math.random() - 0.5) * 0.0036
function homeNear(branchId: string, fallback: { lat: number; lng: number }) {
  const b = db().branches.find((x) => x.id === branchId)
  return b ? { homeLat: b.lat + jitter(), homeLng: b.lng + jitter() } : { homeLat: fallback.lat, homeLng: fallback.lng }
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */
export interface VehicleFormValues {
  reg: string
  make: string
  model: string
  year: number
  category: VehicleCategory
  colour: string
  vin: string
  engineNo: string
  fuelType: FuelType
  tankCapacityL: number
  loadCapacityKg: number
  seats?: number
  axles: number
  branchId: string
  odometerKm: number
  /** yyyy-mm-dd */
  purchaseDate: string
  purchaseCostUsd: number
  deviceId: string
  driverId?: string
  notes?: string
}

export function createVehicle(values: VehicleFormValues): Vehicle {
  const reg = normaliseReg(values.reg)
  const home = homeNear(values.branchId, { lat: -17.83, lng: 31.05 })
  const record = db().insert(
    'vehicles',
    {
      reg,
      make: values.make.trim(),
      model: values.model.trim(),
      year: values.year,
      category: values.category,
      vin: values.vin.trim().toUpperCase(),
      engineNo: values.engineNo.trim().toUpperCase(),
      colour: values.colour.trim(),
      fuelType: values.fuelType,
      tankCapacityL: values.tankCapacityL,
      loadCapacityKg: values.loadCapacityKg,
      seats: values.seats,
      axles: values.axles,
      branchId: values.branchId,
      driverId: null,
      status: 'active',
      odometerKm: values.odometerKm,
      fuelPct: 50,
      purchaseDate: fromInputDate(values.purchaseDate),
      purchaseCostUsd: values.purchaseCostUsd,
      deviceId: values.deviceId.trim().toUpperCase(),
      ...home,
      notes: values.notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    },
    { summary: `Registered vehicle ${reg} (${values.make.trim()} ${values.model.trim()})` },
  )
  return record
}

const FIELD_LABEL: Record<string, string> = {
  reg: 'registration', make: 'make', model: 'model', year: 'year', category: 'category', colour: 'colour', vin: 'VIN', engineNo: 'engine no.', fuelType: 'fuel type', tankCapacityL: 'tank capacity',
  loadCapacityKg: 'load capacity', seats: 'seats', axles: 'axles', branchId: 'branch', odometerKm: 'odometer', purchaseDate: 'purchase date', purchaseCostUsd: 'purchase cost', deviceId: 'device id', notes: 'notes',
}

export function updateVehicle(id: string, values: Omit<VehicleFormValues, 'driverId'>): Vehicle {
  const current = db().vehicles.find((v) => v.id === id)
  if (!current) throw new Error('Vehicle no longer exists')
  const reg = normaliseReg(values.reg)
  const patch: Partial<Vehicle> = {
    reg,
    make: values.make.trim(),
    model: values.model.trim(),
    year: values.year,
    category: values.category,
    vin: values.vin.trim().toUpperCase(),
    engineNo: values.engineNo.trim().toUpperCase(),
    colour: values.colour.trim(),
    fuelType: values.fuelType,
    tankCapacityL: values.tankCapacityL,
    loadCapacityKg: values.loadCapacityKg,
    seats: values.seats,
    axles: values.axles,
    branchId: values.branchId,
    odometerKm: values.odometerKm,
    purchaseDate: fromInputDate(values.purchaseDate),
    purchaseCostUsd: values.purchaseCostUsd,
    deviceId: values.deviceId.trim().toUpperCase(),
    notes: values.notes?.trim() || undefined,
  }
  if (values.branchId !== current.branchId) Object.assign(patch, homeNear(values.branchId, { lat: current.homeLat, lng: current.homeLng }))
  const changed = (Object.keys(FIELD_LABEL) as (keyof Vehicle)[]).filter((k) => {
    if (k === 'purchaseDate') return current.purchaseDate.slice(0, 10) !== patch.purchaseDate?.slice(0, 10)
    return (current[k] ?? undefined) !== (patch[k] ?? undefined)
  })
  db().update('vehicles', id, patch, { summary: changed.length ? `Updated vehicle ${reg}: ${changed.map((k) => FIELD_LABEL[k]).join(', ')}` : `Updated vehicle ${reg}` })
  return { ...current, ...patch } as Vehicle
}

export function changeBranch(ids: string[], branchId: string): number {
  const branch = db().branches.find((b) => b.id === branchId)
  if (!branch) throw new Error('Select a valid branch')
  let n = 0
  for (const id of ids) {
    const v = db().vehicles.find((x) => x.id === id)
    if (!v || v.branchId === branchId) continue
    db().update('vehicles', id, { branchId, ...homeNear(branchId, { lat: v.homeLat, lng: v.homeLng }) }, { summary: `Moved vehicle ${v.reg} to ${branch.name}` })
    n++
  }
  return n
}

/* ------------------------------------------------------------------ */
/* Driver assignment (keeps vehicle.driverId ⇄ driver.vehicleId in sync) */
/* ------------------------------------------------------------------ */
export function assignDriver(vehicleId: string, driverId: string | null, opts: { silent?: boolean } = {}) {
  const vehicle = db().vehicles.find((v) => v.id === vehicleId)
  if (!vehicle) throw new Error('Vehicle no longer exists')
  const previousDriver = db().drivers.find((d) => d.id === vehicle.driverId)
  const driver = driverId ? db().drivers.find((d) => d.id === driverId) : undefined
  if (driverId && !driver) throw new Error('Driver no longer exists')
  if ((vehicle.driverId ?? null) === (driverId ?? null)) return

  const trip = activeTripOf(vehicleId)
  if (trip) throw new Error(`${vehicle.reg} is on active trip ${trip.ref}. Change the driver once the trip is completed.`)

  // release the vehicle's current holder
  if (previousDriver) db().update('drivers', previousDriver.id, { vehicleId: null }, { silent: true })
  // release the driver's previous vehicle
  let movedFrom: Vehicle | undefined
  if (driver?.vehicleId && driver.vehicleId !== vehicleId) {
    movedFrom = db().vehicles.find((v) => v.id === driver.vehicleId)
    if (movedFrom) {
      if (activeTripOf(movedFrom.id)) throw new Error(`${driver.name} is driving ${movedFrom.reg} on an active trip and cannot be reassigned yet.`)
      db().update('vehicles', movedFrom.id, { driverId: null }, { silent: true })
    }
  }
  if (driver) db().update('drivers', driver.id, { vehicleId }, { silent: true })

  const summary = driver
    ? `Assigned driver ${driver.name} to ${vehicle.reg}${previousDriver ? ` (replacing ${previousDriver.name})` : ''}${movedFrom ? ` — released from ${movedFrom.reg}` : ''}`
    : previousDriver
      ? `Unassigned driver ${previousDriver.name} from ${vehicle.reg}`
      : `Cleared driver assignment on ${vehicle.reg}`
  db().update('vehicles', vehicleId, { driverId }, { action: 'assign', summary, silent: opts.silent })
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */
export interface StatusChangeInput {
  status: VehicleStatus
  reason?: string
  /** Only honoured for a single vehicle moving into maintenance. */
  workOrder?: { type: WorkOrderType; title: string; priority: WorkOrder['priority']; providerId: string; description?: string }
  /** When returning to service, complete the vehicle's in-progress work orders. */
  closeWorkOrders?: boolean
}

function nextWoNo(): string {
  let max = 24000
  for (const w of db().workOrders) {
    const m = /(\d+)$/.exec(w.woNo)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `WO-${max + 1}`
}

export function changeStatus(ids: string[], input: StatusChangeInput): { changed: string[]; blocked: { reg: string; reason: string }[]; unchanged: number } {
  const changed: string[] = []
  const blocked: { reg: string; reason: string }[] = []
  let unchanged = 0
  for (const id of ids) {
    const v = db().vehicles.find((x) => x.id === id)
    if (!v) continue
    if (v.status === input.status) {
      unchanged++
      continue
    }
    if (input.status !== 'active') {
      const trip = activeTripOf(id)
      if (trip) {
        blocked.push({ reg: v.reg, reason: `on active trip ${trip.ref}` })
        continue
      }
    }
    const reason = input.reason?.trim()
    db().update('vehicles', id, { status: input.status }, {
      action: 'status',
      summary: `Changed ${v.reg} status: ${VEHICLE_STATUS[v.status].label} → ${VEHICLE_STATUS[input.status].label}${reason ? ` — ${reason}` : ''}`,
    })
    changed.push(id)

    if (input.status === 'maintenance' && input.workOrder && ids.length === 1) {
      const wo = input.workOrder
      const now = new Date().toISOString()
      db().insert('workOrders', {
        woNo: nextWoNo(),
        vehicleId: id,
        branchId: v.branchId,
        type: wo.type,
        title: wo.title.trim(),
        description: wo.description?.trim() || reason || wo.title.trim(),
        priority: wo.priority,
        status: 'in_progress',
        providerId: wo.providerId,
        requestedBy: currentUserName(),
        technician: '',
        requestedAt: now,
        scheduledDate: now,
        startedAt: now,
        completedAt: null,
        odometerKm: v.odometerKm,
        downtimeHours: 0,
        labourCostUsd: 0,
        partsCostUsd: 0,
        parts: [],
      })
    }
    if (input.status === 'active' && input.closeWorkOrders) {
      for (const w of db().workOrders.filter((x) => x.vehicleId === id && x.status === 'in_progress')) {
        const started = w.startedAt ? new Date(w.startedAt).getTime() : Date.now()
        db().update('workOrders', w.id, { status: 'completed', completedAt: new Date().toISOString(), downtimeHours: Math.max(1, Math.round((Date.now() - started) / 36e5)) }, {
          action: 'status',
          summary: `Completed work order ${w.woNo} — ${v.reg} returned to service`,
        })
      }
    }
  }
  return { changed, blocked, unchanged }
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */
export interface ScheduleMaintenanceInput {
  type: WorkOrderType
  title: string
  description?: string
  priority: WorkOrder['priority']
  providerId: string
  /** yyyy-mm-dd */
  scheduledDate: string
  technician?: string
}

export function scheduleMaintenance(vehicleId: string, input: ScheduleMaintenanceInput): WorkOrder {
  const v = db().vehicles.find((x) => x.id === vehicleId)
  if (!v) throw new Error('Vehicle no longer exists')
  const woNo = nextWoNo()
  return db().insert(
    'workOrders',
    {
      woNo,
      vehicleId,
      branchId: v.branchId,
      type: input.type,
      title: input.title.trim(),
      description: input.description?.trim() || input.title.trim(),
      priority: input.priority,
      status: 'scheduled',
      providerId: input.providerId,
      requestedBy: currentUserName(),
      technician: input.technician?.trim() ?? '',
      requestedAt: new Date().toISOString(),
      scheduledDate: fromInputDate(input.scheduledDate),
      startedAt: null,
      completedAt: null,
      odometerKm: v.odometerKm,
      downtimeHours: 0,
      labourCostUsd: 0,
      partsCostUsd: 0,
      parts: [],
    },
    { summary: `Scheduled ${input.title.trim()} (${woNo}) for ${v.reg}` },
  )
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */
export interface DocumentInput {
  type: DocumentType
  number: string
  issuer: string
  /** yyyy-mm-dd */
  issueDate: string
  expiryDate: string
  fileName: string
  fileSizeKb: number
}

export function addDocument(vehicleId: string, input: DocumentInput): DocumentRecord {
  const v = db().vehicles.find((x) => x.id === vehicleId)
  if (!v) throw new Error('Vehicle no longer exists')
  return db().insert(
    'documents',
    {
      entityType: 'vehicle',
      entityId: vehicleId,
      type: input.type,
      number: input.number.trim(),
      issuer: input.issuer.trim(),
      issueDate: fromInputDate(input.issueDate),
      expiryDate: fromInputDate(input.expiryDate),
      fileName: input.fileName,
      fileSizeKb: input.fileSizeKb,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUserName(),
    },
    { summary: `Uploaded ${input.type.replace(/_/g, ' ')} document ${input.number.trim()} for ${v.reg}` },
  )
}

export function renewDocument(docId: string, input: DocumentInput) {
  const doc = db().documents.find((d) => d.id === docId)
  if (!doc) throw new Error('Document no longer exists')
  const v = db().vehicles.find((x) => x.id === doc.entityId)
  db().update(
    'documents',
    docId,
    {
      number: input.number.trim(),
      issuer: input.issuer.trim(),
      issueDate: fromInputDate(input.issueDate),
      expiryDate: fromInputDate(input.expiryDate),
      fileName: input.fileName,
      fileSizeKb: input.fileSizeKb,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUserName(),
    },
    { summary: `Renewed ${doc.type.replace(/_/g, ' ')} ${input.number.trim()}${v ? ` for ${v.reg}` : ''}` },
  )
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */
/** What deleting these vehicles would touch — used to build an informative confirmation. */
export function deletionImpact(ids: string[]) {
  const set = new Set(ids)
  const s = db()
  return {
    blocked: s.vehicles.filter((v) => set.has(v.id) && activeTripOf(v.id)).map((v) => ({ id: v.id, reg: v.reg, trip: activeTripOf(v.id)!.ref })),
    documents: s.documents.filter((d) => d.entityType === 'vehicle' && set.has(d.entityId)).length,
    schedules: s.schedules.filter((x) => set.has(x.vehicleId)).length,
    upcomingTrips: s.trips.filter((t) => t.vehicleId && set.has(t.vehicleId) && (t.status === 'scheduled' || t.status === 'ready')).length,
    drivers: s.drivers.filter((d) => d.vehicleId && set.has(d.vehicleId)).length,
  }
}

export function deleteVehicles(ids: string[]): { deleted: string[]; blocked: { reg: string; trip: string }[] } {
  const impact = deletionImpact(ids)
  const blockedIds = new Set(impact.blocked.map((b) => b.id))
  const doomed = ids.filter((id) => !blockedIds.has(id))
  const set = new Set(doomed)
  const s = db()

  for (const d of s.drivers.filter((x) => x.vehicleId && set.has(x.vehicleId))) db().update('drivers', d.id, { vehicleId: null }, { silent: true })
  for (const t of s.trips.filter((x) => x.vehicleId && set.has(x.vehicleId) && (x.status === 'scheduled' || x.status === 'ready'))) {
    db().update('trips', t.id, { vehicleId: null, driverId: null, status: 'awaiting_assignment' }, { silent: true })
  }
  for (const c of s.fuelCards.filter((x) => x.vehicleId && set.has(x.vehicleId))) {
    db().update('fuelCards', c.id, { vehicleId: null, status: c.status === 'active' ? 'unassigned' : c.status }, { silent: true })
  }
  const docIds = s.documents.filter((d) => d.entityType === 'vehicle' && set.has(d.entityId)).map((d) => d.id)
  if (docIds.length) db().removeMany('documents', docIds, { silent: true })
  const schIds = s.schedules.filter((x) => set.has(x.vehicleId)).map((x) => x.id)
  if (schIds.length) db().removeMany('schedules', schIds, { silent: true })

  for (const id of doomed) {
    const v = db().vehicles.find((x) => x.id === id)
    if (v) db().remove('vehicles', id, { summary: `Deleted vehicle ${v.reg} (${v.make} ${v.model})` })
  }
  return { deleted: doomed, blocked: impact.blocked.map((b) => ({ reg: b.reg, trip: b.trip })) }
}
