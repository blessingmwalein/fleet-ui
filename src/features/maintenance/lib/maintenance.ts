import { useEffect, useMemo, useState } from 'react'
import { addDays, format } from 'date-fns'
import type { Branch, Inspection, PartUsage, ServiceProvider, ServiceSchedule, Vehicle, WorkOrder, WorkOrderStatus, WorkOrderType } from '@/types'
import type { Tone } from '@/components/ui/display'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { WORKORDER_TYPE } from '@/config/status'
import { fmtNumber } from '@/lib/format'

export const DAY = 864e5
export const HOUR = 36e5

/** Fleet-average daily distance used to convert km into "days" when ranking urgency and projecting km-only due dates. */
export const AVG_KM_PER_DAY = 150
export const DUE_SOON_DAYS = 14
export const DUE_SOON_KM = 1000

// ---------------------------------------------------------------------------
// Work-order vocabulary
// ---------------------------------------------------------------------------
export const WO_TYPES = ['preventive', 'corrective', 'breakdown', 'inspection', 'tyre', 'accident_repair'] as const satisfies readonly WorkOrderType[]
export const WO_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const WO_STATUSES = ['requested', 'approved', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const satisfies readonly WorkOrderStatus[]
export const OPEN_STATUSES: readonly WorkOrderStatus[] = ['requested', 'approved', 'scheduled', 'in_progress']

export const WO_TYPE_OPTIONS = WO_TYPES.map((value) => ({ value, label: WORKORDER_TYPE[value] }))
export const WO_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]
export const WO_STATUS_OPTIONS = [
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Chart colour per work-order type (semantic: preventive = green, breakdown = red). */
export const TYPE_COLOR: Record<WorkOrderType, string> = {
  preventive: 'var(--chart-1)',
  corrective: 'var(--chart-2)',
  breakdown: 'var(--chart-6)',
  tyre: 'var(--chart-3)',
  inspection: 'var(--chart-5)',
  accident_repair: 'var(--chart-4)',
}

export type WoAction = 'approve' | 'reject' | 'schedule' | 'start' | 'progress' | 'complete' | 'cancel' | 'edit' | 'delete' | 'reopen'

/** The natural next step of the work-order lifecycle (drives the inline "next action" buttons). */
export const NEXT_STEP: Record<WorkOrderStatus, { kind: WoAction; label: string } | null> = {
  requested: { kind: 'approve', label: 'Approve' },
  approved: { kind: 'schedule', label: 'Schedule' },
  scheduled: { kind: 'start', label: 'Start work' },
  in_progress: { kind: 'complete', label: 'Complete' },
  completed: null,
  cancelled: null,
}

// Local-time date helpers for <input type="date"> round trips (the shared toInputDate uses UTC).
export const toLocalDate = (iso?: string | null) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '')
export const todayLocal = () => format(new Date(), 'yyyy-MM-dd')
export const localDateToIso = (v: string) => (v ? new Date(`${v}T00:00:00`).toISOString() : '')

export const isOpen = (w: Pick<WorkOrder, 'status'>) => OPEN_STATUSES.includes(w.status)
export const woCost = (w: Pick<WorkOrder, 'labourCostUsd' | 'partsCostUsd'>) => w.labourCostUsd + w.partsCostUsd
export const partsTotal = (parts: PartUsage[]) => parts.reduce((s, p) => s + p.qty * p.unitCostUsd, 0)

/** WO scheduled in the past but not yet started. */
export function isLateStart(w: Pick<WorkOrder, 'status' | 'scheduledDate'>, now = Date.now()) {
  return (w.status === 'approved' || w.status === 'scheduled') && new Date(w.scheduledDate).getTime() < now - DAY
}

export function nextWoNo(list: WorkOrder[]) {
  let max = 24000
  for (const w of list) {
    const m = /(\d+)$/.exec(w.woNo)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `WO-${max + 1}`
}

export function nextInspectionRef(list: Inspection[]) {
  let max = 5000
  for (const i of list) {
    const m = /(\d+)$/.exec(i.ref)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `INS-${max + 1}`
}

// ---------------------------------------------------------------------------
// Cross-record markers kept inside `notes` (the domain model has no dedicated link fields)
// ---------------------------------------------------------------------------
const MARKER_RE = /\s*\[(sch|ins):([\w-]+)\]/g
export const scheduleMarker = (id: string) => `[sch:${id}]`
export const inspectionMarker = (id: string) => `[ins:${id}]`
export const linkedScheduleId = (notes?: string) => /\[sch:([\w-]+)\]/.exec(notes ?? '')?.[1] ?? null
export const linkedInspectionId = (notes?: string) => /\[ins:([\w-]+)\]/.exec(notes ?? '')?.[1] ?? null
export const cleanNotes = (notes?: string) => (notes ?? '').replace(MARKER_RE, '').trim()
export const appendNote = (notes: string | undefined, line: string) => [notes?.trim(), line].filter(Boolean).join('\n')

// ---------------------------------------------------------------------------
// Service-schedule health (overdue / due soon / OK)
// ---------------------------------------------------------------------------
export type ScheduleState = 'overdue' | 'due_soon' | 'ok'

export const SCHEDULE_STATE: Record<ScheduleState, { label: string; tone: Tone }> = {
  overdue: { label: 'Overdue', tone: 'danger' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  ok: { label: 'OK', tone: 'success' },
}

export interface ScheduleHealth {
  state: ScheduleState
  /** Calendar days until the next due date (negative = overdue). `null` when the schedule has no day interval. */
  daysLeft: number | null
  /** Kilometres until the next due odometer (negative = overdue). `null` when the schedule has no km interval. */
  kmLeft: number | null
  /** Share of the service interval already consumed (max of distance and time), 0–150. */
  usedPct: number
  /** What triggered the state. */
  basis: 'date' | 'distance' | 'both' | null
  /** "12 d overdue · 340 km over" / "6 d · 820 km" */
  remaining: string
  /** Sort key in "days equivalent" — smaller is more urgent. */
  urgency: number
}

export function scheduleHealth(s: ServiceSchedule, odometerKm: number, now = Date.now()): ScheduleHealth {
  const daysLeft = s.intervalDays != null ? Math.ceil((new Date(s.nextDueDate).getTime() - now) / DAY) : null
  const kmLeft = s.intervalKm != null ? Math.round(s.nextDueKm - odometerKm) : null

  const usedKm = s.intervalKm ? (odometerKm - s.lastServiceKm) / s.intervalKm : 0
  const usedDays = s.intervalDays ? (now - new Date(s.lastServiceDate).getTime()) / DAY / s.intervalDays : 0
  const usedPct = Math.max(0, Math.min(150, Math.max(usedKm, usedDays) * 100))

  const overdueDate = daysLeft !== null && daysLeft < 0
  const overdueKm = kmLeft !== null && kmLeft < 0
  const soonDate = daysLeft !== null && daysLeft <= DUE_SOON_DAYS
  const soonKm = kmLeft !== null && kmLeft <= DUE_SOON_KM

  const state: ScheduleState = overdueDate || overdueKm ? 'overdue' : soonDate || soonKm ? 'due_soon' : 'ok'
  const flags = state === 'overdue' ? [overdueDate, overdueKm] : state === 'due_soon' ? [soonDate, soonKm] : [false, false]
  const basis = flags[0] && flags[1] ? 'both' : flags[0] ? 'date' : flags[1] ? 'distance' : null

  const parts: string[] = []
  if (daysLeft !== null) parts.push(daysLeft < 0 ? `${-daysLeft} d overdue` : daysLeft === 0 ? 'due today' : `${daysLeft} d`)
  if (kmLeft !== null) parts.push(kmLeft < 0 ? `${fmtNumber(-kmLeft)} km over` : `${fmtNumber(kmLeft)} km`)

  const urgency = Math.min(daysLeft ?? Infinity, kmLeft !== null ? kmLeft / AVG_KM_PER_DAY : Infinity)
  return { state, daysLeft, kmLeft, usedPct, basis, remaining: parts.join(' · ') || '—', urgency: Number.isFinite(urgency) ? urgency : 9999 }
}

/** Next due date / odometer after a service performed at (`lastDate`, `lastKm`). */
export function computeNextDue(intervalKm: number | null, intervalDays: number | null, lastDate: Date, lastKm: number) {
  const days = intervalDays ?? (intervalKm ? Math.max(1, Math.round(intervalKm / AVG_KM_PER_DAY)) : 90)
  return { nextDueDate: addDays(lastDate, days).toISOString(), nextDueKm: lastKm + (intervalKm ?? 0) }
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------
export const INSPECTION_ITEMS = [
  'Tyres & wheel nuts', 'Brakes & air system', 'Lights & indicators', 'Steering & suspension', 'Fluid levels & leaks',
  'Mirrors & windscreen', 'Seat belts & cab', 'Fire extinguisher & triangles', 'Load securing / tarp', 'Documents on board',
]
/** A failure on any of these makes the vehicle unroadworthy → inspection result "fail". */
export const CRITICAL_ITEMS = ['Tyres & wheel nuts', 'Brakes & air system', 'Steering & suspension']

export const INSPECTION_TYPE: Record<Inspection['type'], string> = { pre_trip: 'Pre-trip', post_trip: 'Post-trip', periodic: 'Periodic', roadworthiness: 'Roadworthiness' }
export const INSPECTION_RESULT: Record<Inspection['result'], { label: string; tone: Tone }> = {
  pass: { label: 'Pass', tone: 'success' },
  conditional: { label: 'Conditional', tone: 'warning' },
  fail: { label: 'Fail', tone: 'danger' },
}

export function deriveInspectionResult(checklist: { item: string; ok: boolean }[]): Inspection['result'] {
  const failed = checklist.filter((c) => !c.ok)
  if (!failed.length) return 'pass'
  return failed.some((c) => CRITICAL_ITEMS.includes(c.item)) ? 'fail' : 'conditional'
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
export const PROVIDER_STATUS: Record<ServiceProvider['status'], { label: string; tone: Tone }> = {
  preferred: { label: 'Preferred', tone: 'success' },
  approved: { label: 'Approved', tone: 'info' },
  on_hold: { label: 'On hold', tone: 'warning' },
}

export function defaultProviderId(vehicle: Vehicle | undefined, branches: Branch[], providers: ServiceProvider[]) {
  const city = branches.find((b) => b.id === vehicle?.branchId)?.city
  const internal = providers.filter((p) => p.type === 'internal' && p.status !== 'on_hold')
  return (internal.find((p) => p.city === city) ?? internal[0] ?? providers[0])?.id ?? ''
}

/** Workshop branch backing an internal provider (matched by city; the dedicated workshop wins). */
export function bayBranchFor(provider: ServiceProvider, branches: Branch[]) {
  if (provider.type !== 'internal') return undefined
  const inCity = branches.filter((b) => b.city === provider.city && b.bayCapacity > 0)
  return inCity.find((b) => b.type === 'workshop') ?? inCity.find((b) => b.type === 'depot') ?? inCity[0]
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
/** Re-renders consumers once a minute so time-derived values (overdue, due soon) stay current. */
export function useMinuteTick() {
  const [t, setT] = useState(() => Math.floor(Date.now() / 6e4))
  useEffect(() => {
    const id = setInterval(() => setT(Math.floor(Date.now() / 6e4)), 30000)
    return () => clearInterval(id)
  }, [])
  return t
}

/**
 * Current odometer (km) per vehicle: the larger of the stored value and the live telemetry reading.
 * Subscribes to a rounded string signature so consumers don't re-render on every 2 s telemetry tick.
 */
export function useOdometers(): Map<string, number> {
  const vehicles = useDb((s) => s.vehicles)
  const sig = useLive((s) => {
    let out = ''
    for (const t of Object.values(s.telemetry)) out += `${t.vehicleId}:${Math.round(t.odometerKm)},`
    return out
  })
  return useMemo(() => {
    const live = new Map<string, number>()
    for (const p of sig.split(',')) {
      if (!p) continue
      const [id, km] = p.split(':')
      if (id) live.set(id, Number(km))
    }
    return new Map(vehicles.map((v) => [v.id, Math.max(v.odometerKm, live.get(v.id) ?? 0)]))
  }, [sig, vehicles])
}
