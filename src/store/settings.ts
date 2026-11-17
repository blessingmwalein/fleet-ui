import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NotificationType } from '@/types'

export type Currency = 'USD' | 'ZWG'

export interface ChannelPrefs {
  inApp: boolean
  email: boolean
  sms: boolean
}

export const NOTIFICATION_TYPE_META: { type: NotificationType; label: string; description: string }[] = [
  { type: 'speeding', label: 'Speeding', description: 'Vehicle exceeds the speed limit for its category' },
  { type: 'geofence_enter', label: 'Geofence entry', description: 'Vehicle enters a monitored zone' },
  { type: 'geofence_exit', label: 'Geofence exit', description: 'Vehicle leaves a monitored zone' },
  { type: 'trip_delayed', label: 'Trip delayed', description: 'Trip falls behind its planned schedule' },
  { type: 'trip_started', label: 'Trip started', description: 'Vehicle departs on a dispatched trip' },
  { type: 'delivery_completed', label: 'Delivery completed', description: 'Trip finished and proof of delivery captured' },
  { type: 'maintenance_overdue', label: 'Maintenance overdue', description: 'Service interval exceeded' },
  { type: 'low_fuel', label: 'Low fuel', description: 'Fuel level below the configured threshold' },
  { type: 'licence_expiring', label: 'Driver licence expiring', description: 'Licence, medical or training expiry approaching' },
  { type: 'document_expiring', label: 'Vehicle document expiring', description: 'Insurance, roadworthiness or permits expiring' },
  { type: 'vehicle_offline', label: 'Vehicle offline', description: 'GPS device stops reporting' },
  { type: 'vehicle_online', label: 'Vehicle back online', description: 'GPS device resumes reporting' },
  { type: 'incident_reported', label: 'Incident reported', description: 'New accident, breakdown or theft report' },
  { type: 'harsh_event', label: 'Harsh driving event', description: 'Harsh braking, acceleration or cornering' },
  { type: 'system', label: 'System messages', description: 'Product and integration notices' },
]

export interface CompanyInfo {
  name: string
  legalName: string
  registrationNo: string
  taxNo: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website: string
}

export interface Thresholds {
  lowFuelPct: number
  docExpiryWarnDays: number
  idleAlertMinutes: number
  harshBrakeG: number
  maxDriveHours: number
}

export interface SimulationSettings {
  enabled: boolean
  /** Interval between simulated GPS fixes, in milliseconds. */
  intervalMs: number
  /** Demo speed-up factor applied to vehicle movement (1 = real time). */
  timeScale: number
  /** Generate simulated operational events (alerts, incidents, geofence crossings). */
  events: boolean
}

interface SettingsState {
  currency: Currency
  /** ZiG per 1 USD — used when display currency is ZWG. */
  zwgRate: number
  timezone: string
  company: CompanyInfo
  thresholds: Thresholds
  notificationPrefs: Record<string, ChannelPrefs>
  simulation: SimulationSettings
  set: (patch: Partial<Pick<SettingsState, 'currency' | 'zwgRate' | 'timezone'>>) => void
  setCompany: (patch: Partial<CompanyInfo>) => void
  setThresholds: (patch: Partial<Thresholds>) => void
  setSimulation: (patch: Partial<SimulationSettings>) => void
  setChannel: (type: NotificationType, channel: keyof ChannelPrefs, value: boolean) => void
}

const defaultPrefs = Object.fromEntries(
  NOTIFICATION_TYPE_META.map((m) => [
    m.type,
    { inApp: true, email: ['incident_reported', 'maintenance_overdue', 'licence_expiring', 'document_expiring', 'vehicle_offline'].includes(m.type), sms: ['incident_reported', 'speeding'].includes(m.type) },
  ]),
) as Record<string, ChannelPrefs>

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currency: 'USD',
      zwgRate: 26.8,
      timezone: 'Africa/Harare',
      company: {
        name: 'Zambezi Freight & Logistics',
        legalName: 'Zambezi Freight & Logistics (Private) Limited',
        registrationNo: '4417/2009',
        taxNo: 'BP 0712 5546',
        address: '14 Gleneagles Rd, Msasa Industrial Area',
        city: 'Harare',
        country: 'Zimbabwe',
        phone: '+263 242 486 100',
        email: 'info@zambezifreight.co.zw',
        website: 'www.zambezifreight.co.zw',
      },
      thresholds: { lowFuelPct: 15, docExpiryWarnDays: 30, idleAlertMinutes: 15, harshBrakeG: 0.45, maxDriveHours: 9 },
      notificationPrefs: defaultPrefs,
      simulation: { enabled: true, intervalMs: 2000, timeScale: 12, events: true },
      set: (patch) => set(patch),
      setCompany: (patch) => set((s) => ({ company: { ...s.company, ...patch } })),
      setThresholds: (patch) => set((s) => ({ thresholds: { ...s.thresholds, ...patch } })),
      setSimulation: (patch) => set((s) => ({ simulation: { ...s.simulation, ...patch } })),
      setChannel: (type, channel, value) =>
        set((s) => ({ notificationPrefs: { ...s.notificationPrefs, [type]: { ...(s.notificationPrefs[type] ?? { inApp: true, email: false, sms: false }), [channel]: value } } })),
    }),
    { name: 'fleetcore.settings' },
  ),
)
