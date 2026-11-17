import type { Driver, DocumentRecord, DocumentType, DriverStatus, Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import { DRIVER_STATUS, VEHICLE_CATEGORY, expiryState } from '@/config/status'
import { fromInputDate } from '@/components/forms/fields'
import { HEAVY_CATEGORIES, HEAVY_LICENCE_CLASSES, isActiveTrip, isUpcomingTrip } from './driverData'

/* ----------------------------------------------------------------------------------------------
 * All driver mutations live here so every screen (list, detail, dialogs, bulk actions) keeps the
 * vehicle.driverId <-> driver.vehicleId pair consistent and writes meaningful audit entries.
 * -------------------------------------------------------------------------------------------- */

const st = () => useDb.getState()
const DAY = 864e5

export interface DriverFormValues {
  name: string
  empNo: string
  phone: string
  email: string
  nationalId: string
  dob: string
  gender: string
  address: string
  licenceNo: string
  licenceClass: string
  licenceExpiry: string
  defensiveDrivingExpiry: string
  medicalExpiry: string
  hireDate: string
  employmentType: string
  branchId: string
  salaryUsd: number
  emergencyContact: string
  emergencyPhone: string
  vehicleId?: string
  notes?: string
}

export function nextEmpNo(): string {
  let max = 1100
  for (const d of st().drivers) {
    const m = /(\d+)$/.exec(d.empNo)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `ZFL-${max + 7}`
}

function nextDocId() {
  const n = Number(/-(\d+)$/.exec(st().nextId('documents'))?.[1] ?? 1)
  return `doc-${String(n).padStart(4, '0')}`
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
/** True when another driver already uses this licence / national id / employee number. */
export function driverConflict(field: 'licenceNo' | 'nationalId' | 'empNo', value: string, exceptId?: string) {
  const v = norm(value)
  return st().drivers.find((d) => d.id !== exceptId && norm(d[field]) === v)
}

function patchFromForm(v: DriverFormValues) {
  return {
    name: v.name.trim().replace(/\s+/g, ' '),
    empNo: v.empNo.trim().toUpperCase(),
    phone: v.phone.trim(),
    email: v.email.trim().toLowerCase(),
    nationalId: v.nationalId.trim().toUpperCase(),
    dob: fromInputDate(v.dob),
    gender: (v.gender === 'female' ? 'female' : 'male') as Driver['gender'],
    address: v.address.trim(),
    licenceNo: v.licenceNo.trim().toUpperCase(),
    licenceClass: v.licenceClass,
    licenceExpiry: fromInputDate(v.licenceExpiry),
    defensiveDrivingExpiry: fromInputDate(v.defensiveDrivingExpiry),
    medicalExpiry: fromInputDate(v.medicalExpiry),
    hireDate: fromInputDate(v.hireDate),
    employmentType: v.employmentType as Driver['employmentType'],
    branchId: v.branchId,
    salaryUsd: v.salaryUsd,
    emergencyContact: v.emergencyContact.trim(),
    emergencyPhone: v.emergencyPhone.trim(),
    notes: v.notes?.trim() || undefined,
  }
}

const DOC_DEFAULTS: Record<'driver_licence' | 'defensive_driving' | 'medical', { issuer: string; prefix: string; years: number }> = {
  driver_licence: { issuer: 'VID Zimbabwe', prefix: 'DL', years: 5 },
  defensive_driving: { issuer: 'TSCZ', prefix: 'DD', years: 2 },
  medical: { issuer: 'Occupational Health Clinic', prefix: 'MED', years: 1 },
}

function seedComplianceDocs(driver: Driver) {
  const now = Date.now()
  const pairs: ['driver_licence' | 'defensive_driving' | 'medical', string][] = [
    ['driver_licence', driver.licenceExpiry],
    ['defensive_driving', driver.defensiveDrivingExpiry],
    ['medical', driver.medicalExpiry],
  ]
  for (const [type, expiry] of pairs) {
    const def = DOC_DEFAULTS[type]
    const exp = new Date(expiry).getTime()
    const issue = Math.min(exp - def.years * 365 * DAY, now - DAY)
    st().insert(
      'documents',
      {
        id: nextDocId(),
        entityType: 'driver',
        entityId: driver.id,
        type,
        number: `${def.prefix}-${type === 'driver_licence' ? driver.licenceNo : Math.floor(100000 + Math.random() * 899999)}`,
        issuer: def.issuer,
        issueDate: new Date(issue).toISOString(),
        expiryDate: expiry,
        fileName: `${type}_${driver.id}.pdf`,
        fileSizeKb: Math.floor(180 + Math.random() * 900),
        uploadedAt: new Date(now).toISOString(),
        uploadedBy: currentUserName(),
      },
      { silent: true },
    )
  }
}

function currentUserName() {
  const userId = useSession.getState().userId
  return st().users.find((u) => u.id === userId)?.name ?? 'Fleet Admin'
}

export function createDriver(v: DriverFormValues): Driver {
  const patch = patchFromForm(v)
  const driver = st().insert(
    'drivers',
    { ...patch, vehicleId: null, status: 'active', safetyScore: 85 },
    { summary: `Added driver ${patch.name} (${patch.empNo})` },
  )
  seedComplianceDocs(driver)
  if (v.vehicleId) assignVehicle(driver.id, v.vehicleId, { reassignTrips: true })
  return driver
}

export function updateDriver(id: string, v: DriverFormValues) {
  const patch = patchFromForm(v)
  const prev = st().drivers.find((d) => d.id === id)
  st().update('drivers', id, patch, { summary: `Updated driver ${patch.name} (${patch.empNo})` })
  // keep the compliance document records in step with the expiry fields
  const sync: [DocumentType, string, string | undefined][] = [
    ['driver_licence', patch.licenceExpiry, prev?.licenceExpiry],
    ['defensive_driving', patch.defensiveDrivingExpiry, prev?.defensiveDrivingExpiry],
    ['medical', patch.medicalExpiry, prev?.medicalExpiry],
  ]
  for (const [type, expiry, before] of sync) {
    if (before === expiry) continue
    const doc = st().documents.find((d) => d.entityType === 'driver' && d.entityId === id && d.type === type)
    if (doc) st().update('documents', doc.id, { expiryDate: expiry }, { silent: true })
  }
}

/* ----------------------------------------------------------------------------------------------
 * Vehicle assignment
 * -------------------------------------------------------------------------------------------- */

export interface AssignIssues {
  blockers: string[]
  warnings: string[]
}

export function assignmentIssues(driver: Driver, vehicle: Vehicle): AssignIssues {
  const s = st()
  const blockers: string[] = []
  const warnings: string[] = []
  if (driver.status === 'suspended') blockers.push('Driver is suspended and cannot be assigned a vehicle.')
  if (expiryState(driver.licenceExpiry).state === 'expired') blockers.push('Driver’s licence has expired — renew it before assigning a vehicle.')
  if (vehicle.status === 'out_of_service') blockers.push(`${vehicle.reg} is out of service.`)
  if (HEAVY_CATEGORIES.includes(vehicle.category) && !HEAVY_LICENCE_CLASSES.includes(driver.licenceClass))
    blockers.push(`${VEHICLE_CATEGORY[vehicle.category]}s require a Class 1 or Class 2 licence (driver holds ${driver.licenceClass}).`)
  const vTrip = s.trips.find((t) => t.vehicleId === vehicle.id && isActiveTrip(t))
  if (vTrip && vTrip.driverId !== driver.id) blockers.push(`${vehicle.reg} is on trip ${vTrip.ref} — it can’t change driver mid-trip.`)
  const dTrip = s.trips.find((t) => t.driverId === driver.id && isActiveTrip(t))
  if (dTrip && dTrip.vehicleId !== vehicle.id) blockers.push(`Driver is on trip ${dTrip.ref} — complete it before changing vehicle.`)

  if (vehicle.status === 'maintenance') warnings.push(`${vehicle.reg} is currently in maintenance.`)
  if (driver.status === 'on_leave' || driver.status === 'off_duty') warnings.push(`Driver is ${DRIVER_STATUS[driver.status].label.toLowerCase()} — set them active before dispatch.`)
  if (expiryState(driver.medicalExpiry).state === 'expired') warnings.push('Driver’s medical certificate has expired.')
  const holder = vehicle.driverId && vehicle.driverId !== driver.id ? s.drivers.find((d) => d.id === vehicle.driverId) : null
  if (holder) warnings.push(`${vehicle.reg} is currently assigned to ${holder.name} — they will be unassigned.`)
  if (driver.vehicleId && driver.vehicleId !== vehicle.id) {
    const cur = s.vehicles.find((x) => x.id === driver.vehicleId)
    if (cur) warnings.push(`${driver.name} will be released from ${cur.reg}.`)
  }
  return { blockers, warnings }
}

export function unassignIssues(driver: Driver): string[] {
  const t = st().trips.find((x) => x.driverId === driver.id && isActiveTrip(x))
  return t ? [`${driver.name} is on trip ${t.ref} — complete it before unassigning the vehicle.`] : []
}

/** Upcoming trips on a vehicle that still carry the previous holder (or nobody). */
export function upcomingTripsFor(vehicleId: string, newDriverId: string) {
  return st().trips.filter((t) => t.vehicleId === vehicleId && (t.status === 'scheduled' || t.status === 'ready') && t.driverId !== newDriverId)
}

/**
 * Assigns (or, when `vehicleId` is null, releases) a vehicle — updating BOTH `driver.vehicleId` and
 * `vehicle.driverId`, and releasing whoever held either side before.
 */
export function assignVehicle(driverId: string, vehicleId: string | null, opts: { reassignTrips?: boolean } = {}) {
  const driver = st().drivers.find((d) => d.id === driverId)
  if (!driver) throw new Error('Driver not found')

  if (vehicleId === null) {
    const prev = driver.vehicleId ? st().vehicles.find((v) => v.id === driver.vehicleId) : undefined
    if (prev) st().update('vehicles', prev.id, { driverId: null }, { action: 'assign', summary: `Unassigned driver ${driver.name} from ${prev.reg}` })
    st().update('drivers', driverId, { vehicleId: null }, { action: 'assign', summary: prev ? `Unassigned ${prev.reg} from ${driver.name}` : `Cleared vehicle assignment for ${driver.name}` })
    return
  }

  const vehicle = st().vehicles.find((v) => v.id === vehicleId)
  if (!vehicle) throw new Error('Vehicle not found')
  if (driver.vehicleId === vehicleId && vehicle.driverId === driverId) return

  const holder = vehicle.driverId && vehicle.driverId !== driverId ? st().drivers.find((d) => d.id === vehicle.driverId) : undefined
  if (holder) st().update('drivers', holder.id, { vehicleId: null }, { action: 'assign', summary: `${vehicle.reg} reassigned from ${holder.name} to ${driver.name}` })

  const prevVehicle = driver.vehicleId && driver.vehicleId !== vehicleId ? st().vehicles.find((v) => v.id === driver.vehicleId) : undefined
  if (prevVehicle) st().update('vehicles', prevVehicle.id, { driverId: null }, { action: 'assign', summary: `Unassigned driver ${driver.name} from ${prevVehicle.reg} (moved to ${vehicle.reg})` })

  st().update('vehicles', vehicleId, { driverId }, { action: 'assign', summary: `Assigned driver ${driver.name} to ${vehicle.reg}` })
  st().update('drivers', driverId, { vehicleId }, { action: 'assign', summary: `Assigned ${vehicle.reg} to ${driver.name}${holder ? ` (replacing ${holder.name})` : ''}` })

  if (opts.reassignTrips) {
    const ids = upcomingTripsFor(vehicleId, driverId).map((t) => t.id)
    if (ids.length) st().updateMany('trips', ids, { driverId }, { action: 'assign', summary: `Reassigned ${ids.length} upcoming trip${ids.length === 1 ? '' : 's'} on ${vehicle.reg} to ${driver.name}` })
  }
}

/* ----------------------------------------------------------------------------------------------
 * Status & delete
 * -------------------------------------------------------------------------------------------- */

export interface BulkResult {
  done: string[]
  skipped: { name: string; reason: string }[]
}

export function setDriverStatus(ids: string[], status: DriverStatus, reason: string, unassignVehicle: boolean): BulkResult {
  const result: BulkResult = { done: [], skipped: [] }
  for (const id of ids) {
    const d = st().drivers.find((x) => x.id === id)
    if (!d) continue
    if (d.status === status) {
      result.skipped.push({ name: d.name, reason: `already ${DRIVER_STATUS[status].label.toLowerCase()}` })
      continue
    }
    const trip = st().trips.find((t) => t.driverId === id && isActiveTrip(t))
    if (status !== 'active' && trip) {
      result.skipped.push({ name: d.name, reason: `on active trip ${trip.ref}` })
      continue
    }
    if (status === 'active' && expiryState(d.licenceExpiry).state === 'expired') {
      result.skipped.push({ name: d.name, reason: 'driving licence expired' })
      continue
    }
    st().update('drivers', id, { status }, { action: 'status', summary: `Changed status of ${d.name} from ${DRIVER_STATUS[d.status].label} to ${DRIVER_STATUS[status].label}${reason ? ` — ${reason}` : ''}` })
    if (unassignVehicle && status !== 'active' && d.vehicleId) assignVehicle(id, null)
    result.done.push(d.name)
  }
  return result
}

export function deleteIssues(driver: Driver): string | null {
  const t = st().trips.find((x) => x.driverId === driver.id && isActiveTrip(x))
  return t ? `${driver.name} is on active trip ${t.ref}` : null
}

export function deleteDrivers(ids: string[]): BulkResult {
  const result: BulkResult = { done: [], skipped: [] }
  for (const id of ids) {
    const d = st().drivers.find((x) => x.id === id)
    if (!d) continue
    const issue = deleteIssues(d)
    if (issue) {
      result.skipped.push({ name: d.name, reason: issue.replace(`${d.name} is `, '') })
      continue
    }
    if (d.vehicleId) assignVehicle(id, null)
    // upcoming trips lose their driver; "ready" trips must go back to the assignment queue
    for (const t of st().trips.filter((x) => x.driverId === id && isUpcomingTrip(x))) {
      st().update('trips', t.id, { driverId: null, ...(t.status === 'ready' ? { status: 'awaiting_assignment' as const } : {}) }, { summary: `Removed driver ${d.name} from trip ${t.ref}` })
    }
    const docIds = st().documents.filter((x) => x.entityType === 'driver' && x.entityId === id).map((x) => x.id)
    if (docIds.length) st().removeMany('documents', docIds, { silent: true })
    st().remove('drivers', id, { summary: `Deleted driver ${d.name} (${d.empNo})` })
    result.done.push(d.name)
  }
  return result
}

/* ----------------------------------------------------------------------------------------------
 * Documents
 * -------------------------------------------------------------------------------------------- */

export const DRIVER_DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'driver_licence', label: 'Driving licence' },
  { value: 'medical', label: 'Medical certificate' },
  { value: 'defensive_driving', label: 'Defensive driving certificate' },
  { value: 'prdp', label: 'Professional driving permit (PrDP)' },
]

export interface DocFormValues {
  type: string
  number: string
  issuer: string
  issueDate: string
  expiryDate: string
  fileName: string
  fileSizeKb: number
}

export function addDriverDocument(driverId: string, v: DocFormValues): DocumentRecord {
  const driver = st().drivers.find((d) => d.id === driverId)
  if (!driver) throw new Error('Driver not found')
  const type = v.type as DocumentType
  const expiryDate = fromInputDate(v.expiryDate)
  const doc = st().insert(
    'documents',
    {
      id: nextDocId(),
      entityType: 'driver',
      entityId: driverId,
      type,
      number: v.number.trim(),
      issuer: v.issuer.trim(),
      issueDate: fromInputDate(v.issueDate),
      expiryDate,
      fileName: v.fileName.trim(),
      fileSizeKb: Math.round(v.fileSizeKb),
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUserName(),
    },
    { summary: `Uploaded ${DRIVER_DOC_TYPES.find((t) => t.value === type)?.label ?? type} for ${driver.name}` },
  )
  const field = type === 'driver_licence' ? 'licenceExpiry' : type === 'medical' ? 'medicalExpiry' : type === 'defensive_driving' ? 'defensiveDrivingExpiry' : null
  if (field && new Date(expiryDate).getTime() > new Date(driver[field]).getTime()) st().update('drivers', driverId, { [field]: expiryDate }, { summary: `Updated ${driver.name}'s ${DRIVER_DOC_TYPES.find((t) => t.value === type)?.label.toLowerCase()} expiry to ${expiryDate.slice(0, 10)}` })
  return doc
}
