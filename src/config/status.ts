import type {
  CargoType, DriverStatus, ExpenseCategory, IncidentType, Invoice, LiveState, SafetyEventType, Severity, ShipmentStatus, TripStatus, VehicleCategory, VehicleStatus, WorkOrderStatus, DocumentType, WorkOrderType,
} from '@/types'
import type { Tone } from '@/components/ui/display'

export interface Meta {
  label: string
  tone: Tone
}

export const VEHICLE_STATUS: Record<VehicleStatus, Meta> = {
  active: { label: 'Active', tone: 'success' },
  maintenance: { label: 'In maintenance', tone: 'warning' },
  out_of_service: { label: 'Out of service', tone: 'danger' },
}

/** Live GPS/operational state. `color` is a CSS colour (used on the map and charts). */
export const LIVE_STATE: Record<LiveState, Meta & { color: string; hex: string }> = {
  moving: { label: 'Moving', tone: 'success', color: 'var(--success)', hex: '#34d17a' },
  idle: { label: 'Idle', tone: 'warning', color: 'var(--warning)', hex: '#f2a93b' },
  stopped: { label: 'Stopped', tone: 'info', color: 'var(--info)', hex: '#6b9bf2' },
  maintenance: { label: 'Maintenance', tone: 'neutral', color: 'var(--chart-4)', hex: '#9b8afb' },
  offline: { label: 'Offline', tone: 'danger', color: 'var(--subtle-foreground)', hex: '#8a93a1' },
}

export const TRIP_STATUS: Record<TripStatus, Meta> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  awaiting_assignment: { label: 'Awaiting assignment', tone: 'warning' },
  ready: { label: 'Ready for dispatch', tone: 'info' },
  in_transit: { label: 'In transit', tone: 'success' },
  delayed: { label: 'Delayed', tone: 'danger' },
  completed: { label: 'Completed', tone: 'primary' },
  cancelled: { label: 'Cancelled', tone: 'outline' },
}

export const DRIVER_STATUS: Record<DriverStatus, Meta> = {
  active: { label: 'Active', tone: 'success' },
  off_duty: { label: 'Off duty', tone: 'neutral' },
  on_leave: { label: 'On leave', tone: 'info' },
  suspended: { label: 'Suspended', tone: 'danger' },
}

export const SHIPMENT_STATUS: Record<ShipmentStatus, Meta> = {
  registered: { label: 'Registered', tone: 'neutral' },
  allocated: { label: 'Allocated', tone: 'info' },
  picked_up: { label: 'Picked up', tone: 'info' },
  in_transit: { label: 'In transit', tone: 'success' },
  out_for_delivery: { label: 'Out for delivery', tone: 'primary' },
  delivered: { label: 'Delivered', tone: 'primary' },
  exception: { label: 'Exception', tone: 'danger' },
}

export const WORKORDER_STATUS: Record<WorkOrderStatus, Meta> = {
  requested: { label: 'Requested', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'outline' },
}

export const WORKORDER_TYPE: Record<WorkOrderType, string> = {
  preventive: 'Preventive', corrective: 'Corrective', breakdown: 'Breakdown', inspection: 'Inspection', tyre: 'Tyres', accident_repair: 'Accident repair',
}

export const PRIORITY: Record<string, Meta> = {
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'danger' },
  critical: { label: 'Critical', tone: 'danger' },
}

export const INCIDENT_STATUS: Record<string, Meta> = {
  reported: { label: 'Reported', tone: 'warning' },
  investigating: { label: 'Investigating', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
}

export const INCIDENT_SEVERITY: Record<string, Meta> = {
  minor: { label: 'Minor', tone: 'neutral' },
  moderate: { label: 'Moderate', tone: 'warning' },
  major: { label: 'Major', tone: 'danger' },
  critical: { label: 'Critical', tone: 'danger' },
}

export const INCIDENT_TYPE: Record<IncidentType, string> = {
  collision: 'Collision', rollover: 'Rollover', theft: 'Theft', breakdown: 'Breakdown', cargo_damage: 'Cargo damage', near_miss: 'Near miss', injury: 'Injury', fire: 'Fire', hijack: 'Hijack', other: 'Other',
}

export const SAFETY_EVENT_TYPE: Record<SafetyEventType, string> = {
  harsh_braking: 'Harsh braking', harsh_acceleration: 'Harsh acceleration', speeding: 'Speeding', fatigue: 'Fatigue', harsh_cornering: 'Harsh cornering', seatbelt: 'Seatbelt', phone_use: 'Phone use', idling: 'Excess idling',
}

export const EXPENSE_STATUS: Record<string, Meta> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
}

export const INVOICE_STATUS: Record<Invoice['status'], Meta> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  partial: { label: 'Partially paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
}

export const SEVERITY: Record<Severity, Meta> = {
  info: { label: 'Info', tone: 'info' },
  success: { label: 'Success', tone: 'success' },
  warning: { label: 'Warning', tone: 'warning' },
  critical: { label: 'Critical', tone: 'danger' },
}

export const VEHICLE_CATEGORY: Record<VehicleCategory, string> = {
  heavy_truck: 'Heavy truck', light_truck: 'Light truck', delivery_van: 'Delivery van', pickup: 'Pickup', bus: 'Bus', tanker: 'Tanker', refrigerated: 'Refrigerated', service: 'Service vehicle', motorcycle: 'Motorbike',
}

export const CARGO_TYPE: Record<CargoType, string> = {
  general: 'General freight', fuel: 'Fuel', perishable: 'Perishables', bulk: 'Bulk', passengers: 'Passengers', containers: 'Containers', hazardous: 'Hazardous', equipment: 'Equipment',
}

export const EXPENSE_CATEGORY: Record<ExpenseCategory, string> = {
  fuel: 'Fuel', maintenance: 'Maintenance', toll: 'Tolls', allowance: 'Driver allowances', insurance: 'Insurance', parking: 'Parking', fines: 'Fines', tyres: 'Tyres', licensing: 'Licensing', other: 'Other',
}

export const DOCUMENT_TYPE: Record<DocumentType, string> = {
  insurance: 'Insurance', roadworthiness: 'Roadworthiness cert.', vehicle_licence: 'Vehicle licence', operator_licence: 'Operator licence', carbon_tax: 'Carbon tax', route_permit: 'Route permit',
  fitness_cert: 'Fitness certificate', driver_licence: 'Driver licence', defensive_driving: 'Defensive driving', medical: 'Medical certificate', prdp: 'PrDP',
}

export const BRANCH_TYPE: Record<string, string> = { head_office: 'Head office', depot: 'Depot', branch: 'Branch', workshop: 'Workshop', border_post: 'Border depot' }

export type StatusKind = 'vehicle' | 'live' | 'trip' | 'driver' | 'shipment' | 'workorder' | 'priority' | 'incident' | 'severity' | 'expense' | 'invoice' | 'notification'

const REGISTRY: Record<StatusKind, Record<string, Meta>> = {
  vehicle: VEHICLE_STATUS,
  live: LIVE_STATE,
  trip: TRIP_STATUS,
  driver: DRIVER_STATUS,
  shipment: SHIPMENT_STATUS,
  workorder: WORKORDER_STATUS,
  priority: PRIORITY,
  incident: INCIDENT_STATUS,
  severity: INCIDENT_SEVERITY,
  expense: EXPENSE_STATUS,
  invoice: INVOICE_STATUS,
  notification: SEVERITY,
}

export function statusMeta(kind: StatusKind, value: string): Meta {
  return REGISTRY[kind][value] ?? { label: value.replace(/_/g, ' '), tone: 'neutral' }
}

/** Expiry classification used by documents, licences and insurance across the app. */
export function expiryState(iso: string | null | undefined, warnDays = 30, now = Date.now()): { state: 'expired' | 'expiring' | 'valid' | 'unknown'; days: number; tone: Tone; label: string } {
  if (!iso) return { state: 'unknown', days: 0, tone: 'neutral', label: '—' }
  const days = Math.ceil((new Date(iso).getTime() - now) / 864e5)
  if (days < 0) return { state: 'expired', days, tone: 'danger', label: `Expired ${-days}d ago` }
  if (days <= warnDays) return { state: 'expiring', days, tone: days <= 14 ? 'danger' : 'warning', label: days === 0 ? 'Expires today' : `${days}d left` }
  return { state: 'valid', days, tone: 'success', label: 'Valid' }
}
