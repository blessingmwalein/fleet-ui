/**
 * FleetCore domain model.
 * All monetary amounts are stored in USD (base currency) and converted for display by `useMoney()`.
 * All timestamps are ISO-8601 strings. Ids are short readable strings (e.g. "veh-007", "drv-012").
 */

export type ID = string
export type ISODate = string

export interface LatLng {
  lat: number
  lng: number
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------
export type BranchType = 'head_office' | 'depot' | 'branch' | 'workshop' | 'border_post'

export interface Branch {
  id: ID
  code: string
  name: string
  city: string
  type: BranchType
  address: string
  lat: number
  lng: number
  manager: string
  phone: string
  email: string
  bayCapacity: number
  status: 'active' | 'inactive'
}

export interface Department {
  id: ID
  name: string
  head: string
  headcount: number
  costCentre: string
  description: string
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
export type VehicleCategory =
  | 'heavy_truck'
  | 'light_truck'
  | 'delivery_van'
  | 'pickup'
  | 'bus'
  | 'tanker'
  | 'refrigerated'
  | 'service'
  | 'motorcycle'

/** Administrative status managed by fleet staff (not the GPS state). */
export type VehicleStatus = 'active' | 'maintenance' | 'out_of_service'

/** Live operational state derived from telemetry + admin status. */
export type LiveState = 'moving' | 'idle' | 'stopped' | 'maintenance' | 'offline'

export type FuelType = 'diesel' | 'petrol' | 'lpg'

export interface Vehicle {
  id: ID
  reg: string
  make: string
  model: string
  year: number
  category: VehicleCategory
  vin: string
  engineNo: string
  colour: string
  fuelType: FuelType
  tankCapacityL: number
  loadCapacityKg: number
  seats?: number
  axles: number
  branchId: ID
  driverId: ID | null
  status: VehicleStatus
  odometerKm: number
  fuelPct: number
  purchaseDate: ISODate
  purchaseCostUsd: number
  deviceId: string
  /** Where the vehicle is based/parked when not on a route. */
  homeLat: number
  homeLng: number
  notes?: string
  createdAt: ISODate
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
export type DriverStatus = 'active' | 'off_duty' | 'on_leave' | 'suspended'

export interface Driver {
  id: ID
  name: string
  empNo: string
  phone: string
  email: string
  nationalId: string
  dob: ISODate
  gender: 'male' | 'female'
  address: string
  licenceNo: string
  licenceClass: string
  licenceExpiry: ISODate
  defensiveDrivingExpiry: ISODate
  medicalExpiry: ISODate
  hireDate: ISODate
  branchId: ID
  vehicleId: ID | null
  status: DriverStatus
  safetyScore: number // 0-100
  emergencyContact: string
  emergencyPhone: string
  employmentType: 'permanent' | 'contract' | 'casual'
  salaryUsd: number
  notes?: string
}

// ---------------------------------------------------------------------------
// Customers, trips, shipments
// ---------------------------------------------------------------------------
export interface Customer {
  id: ID
  name: string
  code: string
  industry: string
  contactName: string
  email: string
  phone: string
  city: string
  address: string
  lat: number
  lng: number
  creditLimitUsd: number
  paymentTermsDays: number
  status: 'active' | 'on_hold' | 'inactive'
  createdAt: ISODate
}

export type TripStatus =
  | 'scheduled'
  | 'awaiting_assignment'
  | 'ready'
  | 'in_transit'
  | 'delayed'
  | 'completed'
  | 'cancelled'

export type CargoType = 'general' | 'fuel' | 'perishable' | 'bulk' | 'passengers' | 'containers' | 'hazardous' | 'equipment'

export interface Place {
  name: string
  city: string
  lat: number
  lng: number
}

export interface ProofOfDelivery {
  receivedBy: string
  signedAt: ISODate
  notes?: string
  photoCount: number
  conditionOk: boolean
}

export interface Trip {
  id: ID
  ref: string // TRP-2026-00123
  status: TripStatus
  vehicleId: ID | null
  driverId: ID | null
  customerId: ID | null
  shipmentId: ID | null
  branchId: ID
  routeId: string
  /** +1 = travel the route from first to last coordinate, -1 = reverse */
  routeDir: 1 | -1
  origin: Place
  destination: Place
  cargoType: CargoType
  cargoDescription: string
  cargoWeightKg: number
  scheduledStart: ISODate
  actualStart: ISODate | null
  plannedEnd: ISODate
  actualEnd: ISODate | null
  plannedDistanceKm: number
  actualDistanceKm: number | null
  plannedDurationMin: number
  actualDurationMin: number | null
  delayMinutes: number
  delayReason?: string
  expensesUsd: number
  revenueUsd: number
  pod: ProofOfDelivery | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  notes?: string
  createdAt: ISODate
}

export type ShipmentStatus =
  | 'registered'
  | 'allocated'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'

export interface ShipmentMilestone {
  key: 'registered' | 'allocated' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception'
  label: string
  at: ISODate | null
  note?: string
}

export interface Shipment {
  id: ID
  trackingRef: string // FC-ZW-4829301
  customerId: ID
  tripId: ID | null
  vehicleId: ID | null
  driverId: ID | null
  branchId: ID
  status: ShipmentStatus
  cargoDescription: string
  cargoType: CargoType
  weightKg: number
  packages: number
  declaredValueUsd: number
  chargeUsd: number
  pickup: Place
  delivery: Place
  pickupWindowStart: ISODate
  deliveryEta: ISODate
  deliveredAt: ISODate | null
  milestones: ShipmentMilestone[]
  exception: { type: string; description: string; raisedAt: ISODate; resolved: boolean } | null
  pod: ProofOfDelivery | null
  contactName: string
  contactPhone: string
  createdAt: ISODate
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------
export interface FuelStation {
  id: ID
  name: string
  brand: string
  city: string
  address: string
  lat: number
  lng: number
  dieselPriceUsd: number
  petrolPriceUsd: number
  status: 'approved' | 'suspended'
}

export interface FuelCard {
  id: ID
  number: string // masked e.g. 5412 •••• 7731
  vehicleId: ID | null
  provider: string
  status: 'active' | 'blocked' | 'expired' | 'unassigned'
  monthlyLimitUsd: number
  spentThisMonthUsd: number
  expiry: ISODate
  pinSetAt: ISODate
}

export interface FuelTransaction {
  id: ID
  ref: string
  vehicleId: ID
  driverId: ID | null
  stationId: ID
  cardId: ID | null
  branchId: ID
  tripId: ID | null
  date: ISODate
  litres: number
  pricePerLitreUsd: number
  totalUsd: number
  odometerKm: number
  fuelType: FuelType
  fullTank: boolean
  /** populated when detection rules flag the transaction */
  flag: null | { reason: string; severity: 'low' | 'medium' | 'high'; expectedLitres?: number }
  reconciled: boolean
  receiptNo: string
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------
export interface ServiceProvider {
  id: ID
  name: string
  type: 'internal' | 'external'
  city: string
  specialties: string[]
  contactName: string
  phone: string
  email: string
  rating: number // 1-5
  status: 'preferred' | 'approved' | 'on_hold'
  hourlyRateUsd: number
}

export type WorkOrderType = 'preventive' | 'corrective' | 'breakdown' | 'inspection' | 'tyre' | 'accident_repair'
export type WorkOrderStatus = 'requested' | 'approved' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export interface PartUsage {
  name: string
  partNo: string
  qty: number
  unitCostUsd: number
}

export interface WorkOrder {
  id: ID
  woNo: string // WO-24017
  vehicleId: ID
  branchId: ID
  type: WorkOrderType
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: WorkOrderStatus
  providerId: ID
  requestedBy: string
  technician: string
  requestedAt: ISODate
  scheduledDate: ISODate
  startedAt: ISODate | null
  completedAt: ISODate | null
  odometerKm: number
  downtimeHours: number
  labourCostUsd: number
  partsCostUsd: number
  parts: PartUsage[]
  notes?: string
}

export interface ServiceSchedule {
  id: ID
  vehicleId: ID
  task: string
  intervalKm: number | null
  intervalDays: number | null
  lastServiceDate: ISODate
  lastServiceKm: number
  nextDueDate: ISODate
  nextDueKm: number
  estCostUsd: number
}

export interface Inspection {
  id: ID
  ref: string
  vehicleId: ID
  driverId: ID | null
  branchId: ID
  date: ISODate
  type: 'pre_trip' | 'post_trip' | 'periodic' | 'roadworthiness'
  result: 'pass' | 'conditional' | 'fail'
  odometerKm: number
  checklist: { item: string; ok: boolean; note?: string }[]
  defects: string[]
  inspector: string
}

// ---------------------------------------------------------------------------
// Safety & compliance
// ---------------------------------------------------------------------------
export type IncidentType = 'collision' | 'rollover' | 'theft' | 'breakdown' | 'cargo_damage' | 'near_miss' | 'injury' | 'fire' | 'hijack' | 'other'

export interface Incident {
  id: ID
  ref: string // INC-2026-031
  type: IncidentType
  severity: 'minor' | 'moderate' | 'major' | 'critical'
  status: 'reported' | 'investigating' | 'resolved' | 'closed'
  vehicleId: ID
  driverId: ID | null
  tripId: ID | null
  branchId: ID
  date: ISODate
  location: string
  lat: number
  lng: number
  description: string
  injuries: number
  thirdPartyInvolved: boolean
  policeReportNo?: string
  estCostUsd: number
  insuranceClaim: boolean
  reportedBy: string
  rootCause?: string
  actionsTaken?: string
}

export type SafetyEventType = 'harsh_braking' | 'harsh_acceleration' | 'speeding' | 'fatigue' | 'harsh_cornering' | 'seatbelt' | 'phone_use' | 'idling'

export interface SafetyEvent {
  id: ID
  type: SafetyEventType
  severity: 'low' | 'medium' | 'high'
  vehicleId: ID
  driverId: ID | null
  branchId: ID
  tripId: ID | null
  timestamp: ISODate
  location: string
  lat: number
  lng: number
  speedKph: number
  limitKph?: number
  value?: number // g-force or hours driven
  reviewed: boolean
}

export type DocumentType =
  | 'insurance'
  | 'roadworthiness'
  | 'vehicle_licence'
  | 'operator_licence'
  | 'carbon_tax'
  | 'route_permit'
  | 'fitness_cert'
  | 'driver_licence'
  | 'defensive_driving'
  | 'medical'
  | 'prdp'

export interface DocumentRecord {
  id: ID
  entityType: 'vehicle' | 'driver'
  entityId: ID
  type: DocumentType
  number: string
  issuer: string
  issueDate: ISODate
  expiryDate: ISODate
  fileName: string
  fileSizeKb: number
  uploadedAt: ISODate
  uploadedBy: string
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export type ExpenseCategory = 'fuel' | 'maintenance' | 'toll' | 'allowance' | 'insurance' | 'parking' | 'fines' | 'tyres' | 'licensing' | 'other'

export interface Expense {
  id: ID
  ref: string
  category: ExpenseCategory
  description: string
  amountUsd: number
  date: ISODate
  vehicleId: ID | null
  tripId: ID | null
  driverId: ID | null
  branchId: ID
  supplier: string
  paymentMethod: 'cash' | 'fuel_card' | 'bank_transfer' | 'ecocash' | 'card'
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  submittedBy: string
  approvedBy?: string
  receiptNo?: string
  rejectionReason?: string
}

export interface Invoice {
  id: ID
  number: string
  kind: 'customer' | 'supplier'
  partyId: ID | null // customerId for customer invoices
  partyName: string
  description: string
  amountUsd: number
  paidUsd: number
  issueDate: ISODate
  dueDate: ISODate
  status: 'draft' | 'sent' | 'partial' | 'paid' | 'overdue'
  tripIds: ID[]
  branchId: ID
  paymentRef?: string
  payments: { date: ISODate; amountUsd: number; method: string; ref: string }[]
}

export interface Budget {
  id: ID
  period: string // YYYY-MM
  category: ExpenseCategory | 'total'
  branchId: ID | 'all'
  budgetUsd: number
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export interface Role {
  id: ID
  name: string
  description: string
  permissions: string[] // "module.action"
  builtIn: boolean
}

export interface User {
  id: ID
  name: string
  email: string
  phone: string
  roleId: ID
  branchId: ID | 'all'
  departmentId: ID
  status: 'active' | 'invited' | 'disabled'
  lastLogin: ISODate | null
  twoFactor: boolean
  createdAt: ISODate
}

export interface AuditEntry {
  id: ID
  at: ISODate
  userId: ID
  userName: string
  action: 'create' | 'update' | 'delete' | 'status' | 'login' | 'export' | 'assign' | 'approve' | 'system'
  entityType: string
  entityId: string
  summary: string
}

export type GeofenceKind = 'depot' | 'customer' | 'restricted' | 'border' | 'city'

export interface Geofence {
  id: ID
  name: string
  kind: GeofenceKind
  lat: number
  lng: number
  radiusM: number
  branchId?: ID
  alertOnEnter: boolean
  alertOnExit: boolean
}

// ---------------------------------------------------------------------------
// Notifications & live
// ---------------------------------------------------------------------------
export type Severity = 'info' | 'success' | 'warning' | 'critical'

export type NotificationType =
  | 'speeding'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'trip_delayed'
  | 'delivery_completed'
  | 'maintenance_overdue'
  | 'low_fuel'
  | 'licence_expiring'
  | 'vehicle_offline'
  | 'vehicle_online'
  | 'incident_reported'
  | 'document_expiring'
  | 'trip_started'
  | 'harsh_event'
  | 'system'

export type EntityType =
  | 'vehicle'
  | 'driver'
  | 'trip'
  | 'shipment'
  | 'customer'
  | 'workorder'
  | 'incident'
  | 'expense'
  | 'invoice'
  | 'fuel'
  | 'branch'
  | 'user'
  | 'document'

export interface EntityRef {
  type: EntityType
  id: ID
}

export interface AppNotification {
  id: ID
  ts: ISODate
  type: NotificationType
  severity: Severity
  title: string
  message: string
  entity?: EntityRef
  read: boolean
}

/** Telematics daily fleet summary (engine/GPS-derived aggregates, one row per calendar day). */
export interface DailyStat {
  id: ID // same as date
  date: string // YYYY-MM-DD
  inService: number
  activeVehicles: number
  utilisationPct: number
  drivingHours: number
  idleHours: number
  distanceKm: number
  fuelL: number
}

export interface Telemetry {
  vehicleId: ID
  lat: number
  lng: number
  heading: number // degrees, 0 = north
  speedKph: number
  state: LiveState
  engineOn: boolean
  gpsOnline: boolean
  fuelPct: number
  odometerKm: number
  /** Human readable nearest place, e.g. "A5 Harare–Bulawayo Rd · 12 km N of Kadoma" */
  location: string
  routeId: string | null
  routeDir: 1 | -1
  progressM: number
  routeLengthM: number
  remainingKm: number
  etaTs: number | null
  tripId: ID | null
  lastFixTs: number
  limitKph: number
  speeding: boolean
  delayed: boolean
}
