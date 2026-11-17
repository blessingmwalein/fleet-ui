/** Compliance register domain logic: enriched document rows, grouping, summary and mutations. */
import { useMemo } from 'react'
import { toast } from 'sonner'
import type { Driver, DocumentRecord, DocumentType, Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { useSettings } from '@/store/settings'
import { useBranchScope } from '@/hooks/useFilters'
import { DOCUMENT_TYPE, expiryState } from '@/config/status'
import type { Tone } from '@/components/ui/display'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useNow } from './useSafetyData'

export const VEHICLE_DOC_TYPES: DocumentType[] = ['insurance', 'roadworthiness', 'vehicle_licence', 'operator_licence', 'carbon_tax', 'route_permit', 'fitness_cert']
export const DRIVER_DOC_TYPES: DocumentType[] = ['driver_licence', 'defensive_driving', 'medical', 'prdp']
export const CORE_VEHICLE_DOCS: DocumentType[] = ['insurance', 'roadworthiness', 'vehicle_licence']

export const DEFAULT_ISSUER: Record<DocumentType, string> = {
  insurance: 'Old Mutual Insurance',
  roadworthiness: 'VID Zimbabwe',
  vehicle_licence: 'ZINARA',
  operator_licence: 'Ministry of Transport',
  carbon_tax: 'ZINARA',
  route_permit: 'Ministry of Transport',
  fitness_cert: 'VID Zimbabwe',
  driver_licence: 'VID Zimbabwe',
  defensive_driving: 'TSCZ',
  medical: 'Occupational Health Clinic',
  prdp: 'VID Zimbabwe',
}
export const DOC_PREFIX: Record<DocumentType, string> = {
  insurance: 'POL', roadworthiness: 'CRW', vehicle_licence: 'VL', operator_licence: 'OL', carbon_tax: 'CT', route_permit: 'RP', fitness_cert: 'FC', driver_licence: 'DL', defensive_driving: 'DD', medical: 'MED', prdp: 'PRDP',
}
/** Typical validity period when renewing, in days. */
export const DOC_TERM_DAYS: Record<DocumentType, number> = {
  insurance: 365, roadworthiness: 365, vehicle_licence: 365, operator_licence: 365, carbon_tax: 365, route_permit: 365, fitness_cert: 365, driver_licence: 1825, defensive_driving: 730, medical: 365, prdp: 1095,
}

export interface DocGroup {
  key: string
  label: string
  types: DocumentType[] | null
}
export const DOC_GROUPS: DocGroup[] = [
  { key: 'all', label: 'All documents', types: null },
  { key: 'insurance', label: 'Insurance', types: ['insurance'] },
  { key: 'roadworthiness', label: 'Roadworthiness', types: ['roadworthiness', 'fitness_cert'] },
  { key: 'licence', label: 'Vehicle licences', types: ['vehicle_licence', 'operator_licence'] },
  { key: 'driver', label: 'Driver licences', types: ['driver_licence', 'prdp'] },
  { key: 'training', label: 'Medical & training', types: ['medical', 'defensive_driving'] },
  { key: 'permits', label: 'Permits & tax', types: ['route_permit', 'carbon_tax'] },
]

export type DocState = 'expired' | 'expiring' | 'valid' | 'unknown'

export interface DocRow extends DocumentRecord {
  typeLabel: string
  kind: 'Vehicle' | 'Driver'
  entityName: string
  branchId: string
  branchName: string
  state: DocState
  stateLabel: string
  days: number
  tone: Tone
  /** Who a reminder is addressed to. */
  contactName: string
  contactEmail: string
}

export const STATE_LABEL: Record<DocState, string> = { expired: 'Expired', expiring: 'Expiring soon', valid: 'Valid', unknown: 'Unknown' }

/** Documents enriched with entity names, branch and expiry state — scoped to the global branch filter. */
export function useDocRows() {
  const documents = useDb((s) => s.documents)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branches = useDb((s) => s.branches)
  const warnDays = useSettings((s) => s.thresholds.docExpiryWarnDays)
  const now = useNow(60_000)
  const { scope } = useBranchScope()

  const rows = useMemo(() => {
    const vById = new Map<string, Vehicle>(vehicles.map((v) => [v.id, v]))
    const dById = new Map<string, Driver>(drivers.map((d) => [d.id, d]))
    const bById = new Map(branches.map((b) => [b.id, b]))
    const out: DocRow[] = documents.map((d) => {
      const v = d.entityType === 'vehicle' ? vById.get(d.entityId) : undefined
      const dr = d.entityType === 'driver' ? dById.get(d.entityId) : v?.driverId ? dById.get(v.driverId) : undefined
      const branchId = (d.entityType === 'vehicle' ? v?.branchId : dr?.branchId) ?? ''
      const branch = bById.get(branchId)
      const e = expiryState(d.expiryDate, warnDays, now)
      return {
        ...d,
        typeLabel: DOCUMENT_TYPE[d.type],
        kind: d.entityType === 'vehicle' ? 'Vehicle' : 'Driver',
        entityName: (d.entityType === 'vehicle' ? v?.reg : dr?.name) ?? d.entityId,
        branchId,
        branchName: branch?.name ?? '—',
        state: e.state,
        stateLabel: STATE_LABEL[e.state],
        days: e.days,
        tone: e.tone,
        contactName: d.entityType === 'driver' ? (dr?.name ?? 'Driver') : (dr?.name ?? branch?.manager ?? 'Fleet coordinator'),
        contactEmail: dr?.email ?? branch?.email ?? '',
      }
    })
    return scope(out)
  }, [documents, vehicles, drivers, branches, warnDays, now, scope])

  return { rows, warnDays }
}

export interface ComplianceSummary {
  total: number
  valid: number
  expiring: number
  expired: number
  /** % of documents that are not expired. */
  rate: number
  nonCompliantVehicles: Vehicle[]
  compliantVehiclePct: number
  driversLapsed: number
}

export function summarise(rows: DocRow[], vehicles: Vehicle[]): ComplianceSummary {
  const total = rows.length
  const expired = rows.filter((r) => r.state === 'expired').length
  const expiring = rows.filter((r) => r.state === 'expiring').length
  const byVehicle = new Map<string, DocRow[]>()
  for (const r of rows) if (r.entityType === 'vehicle') (byVehicle.get(r.entityId) ?? byVehicle.set(r.entityId, []).get(r.entityId)!).push(r)
  const nonCompliantVehicles = vehicles.filter((v) => {
    const docs = byVehicle.get(v.id) ?? []
    const missingCore = CORE_VEHICLE_DOCS.some((t) => !docs.some((d) => d.type === t))
    return missingCore || docs.some((d) => d.state === 'expired')
  })
  const lapsedDrivers = new Set(rows.filter((r) => r.entityType === 'driver' && r.state === 'expired').map((r) => r.entityId))
  return {
    total,
    valid: total - expired - expiring,
    expiring,
    expired,
    rate: total ? ((total - expired) / total) * 100 : 100,
    nonCompliantVehicles,
    compliantVehiclePct: vehicles.length ? ((vehicles.length - nonCompliantVehicles.length) / vehicles.length) * 100 : 100,
    driversLapsed: lapsedDrivers.size,
  }
}

// ---------------------------------------------------------------------------
// Reminder bookkeeping (send / snooze). Kept locally — the audit log holds the durable trail.
// ---------------------------------------------------------------------------
interface ReminderState {
  sent: Record<string, string>
  snoozed: Record<string, string>
  markSent: (ids: string[]) => void
  snooze: (id: string, untilIso: string) => void
  unsnooze: (id: string) => void
}

export const useReminderStore = create<ReminderState>()(
  persist(
    (set) => ({
      sent: {},
      snoozed: {},
      markSent: (ids) => set((s) => ({ sent: { ...s.sent, ...Object.fromEntries(ids.map((id) => [id, new Date().toISOString()])) } })),
      snooze: (id, untilIso) => set((s) => ({ snoozed: { ...s.snoozed, [id]: untilIso } })),
      unsnooze: (id) => set((s) => { const n = { ...s.snoozed }; delete n[id]; return { snoozed: n } }),
    }),
    { name: 'fleetcore.safety.reminders' },
  ),
)

export function isSnoozed(snoozed: Record<string, string>, id: string, now = Date.now()) {
  const u = snoozed[id]
  return !!u && new Date(u).getTime() > now
}

/** Send reminders for the given documents: audit entry per document + one summary toast. */
export function sendReminders(rows: DocRow[]) {
  if (!rows.length) return
  for (const r of rows) {
    const urgency = r.state === 'expired' ? `expired ${-r.days}d ago` : `expires in ${r.days}d`
    useDb.getState().update('documents', r.id, {}, { action: 'system', summary: `Compliance reminder sent to ${r.contactName} — ${r.typeLabel} ${r.number} (${r.entityName}) ${urgency}` })
  }
  useReminderStore.getState().markSent(rows.map((r) => r.id))
  if (rows.length === 1) toast.success(`Reminder sent to ${rows[0]!.contactName}`, { description: `${rows[0]!.typeLabel} · ${rows[0]!.entityName}${rows[0]!.contactEmail ? ` · ${rows[0]!.contactEmail}` : ''}` })
  else toast.success(`${rows.length} compliance reminders sent`, { description: `Notified ${new Set(rows.map((r) => r.contactName)).size} recipients by email & in-app.` })
}

const DRIVER_FIELD: Partial<Record<DocumentType, 'licenceExpiry' | 'defensiveDrivingExpiry' | 'medicalExpiry'>> = {
  driver_licence: 'licenceExpiry', defensive_driving: 'defensiveDrivingExpiry', medical: 'medicalExpiry',
}

/** Keep the driver profile's expiry fields (used by the Drivers module) in sync with the register. */
export function mirrorToDriver(doc: Pick<DocumentRecord, 'entityType' | 'entityId' | 'type' | 'expiryDate'>) {
  const f = DRIVER_FIELD[doc.type]
  if (doc.entityType === 'driver' && f) useDb.getState().update('drivers', doc.entityId, { [f]: doc.expiryDate }, { silent: true })
}
