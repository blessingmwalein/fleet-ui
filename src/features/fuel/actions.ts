import { toast } from 'sonner'
import type { Incident } from '@/types'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import { confirm } from '@/store/confirm'
import { navigateTo } from '@/lib/navigation'
import { flagOf, FUEL_RULES, type FlagReview, type FuelFlag, type FuelRow } from './lib'

export function currentUserName(): string {
  const { userId } = useSession.getState()
  return useDb.getState().users.find((u) => u.id === userId)?.name ?? 'System'
}

// ---------------------------------------------------------------------------
// Reconciliation & deletion
// ---------------------------------------------------------------------------
/** Marks unflagged transactions reconciled. Flagged ones are skipped until reviewed. Returns [done, skipped]. */
export function markReconciled(ids: string[], summary?: string): [number, number] {
  const { fuelTransactions, updateMany } = useDb.getState()
  const set = new Set(ids)
  const targets = fuelTransactions.filter((t) => set.has(t.id) && !t.reconciled)
  const eligible = targets.filter((t) => !t.flag)
  const skipped = targets.filter((t) => t.flag).length
  if (eligible.length) updateMany('fuelTransactions', eligible.map((t) => t.id), { reconciled: true }, { action: 'approve', summary: summary ?? `Reconciled ${eligible.length} fuel transaction${eligible.length === 1 ? '' : 's'}` })
  return [eligible.length, skipped]
}

export function reportReconciled(done: number, skipped: number) {
  if (done && skipped) toast.success(`${done} transaction${done === 1 ? '' : 's'} reconciled`, { description: `${skipped} flagged transaction${skipped === 1 ? ' was' : 's were'} skipped — review them first.` })
  else if (done) toast.success(`${done} transaction${done === 1 ? '' : 's'} marked as reconciled`)
  else if (skipped) toast.warning('Nothing reconciled', { description: 'The selected transactions are flagged — review or dismiss the flag first.' })
  else toast.info('Already reconciled')
}

export async function deleteTransactions(rows: { id: string; ref: string }[]): Promise<boolean> {
  if (!rows.length) return false
  const one = rows.length === 1
  const ok = await confirm({
    title: one ? `Delete transaction ${rows[0]!.ref}?` : `Delete ${rows.length} transactions?`,
    description: 'The purchase is removed from fuel spend, efficiency and reconciliation figures. This is recorded in the audit log and cannot be undone.',
    confirmLabel: 'Delete',
    destructive: true,
  })
  if (!ok) return false
  const { remove, removeMany } = useDb.getState()
  if (one) remove('fuelTransactions', rows[0]!.id)
  else removeMany('fuelTransactions', rows.map((r) => r.id))
  toast.success(one ? `Transaction ${rows[0]!.ref} deleted` : `${rows.length} transactions deleted`)
  return true
}

// ---------------------------------------------------------------------------
// Suspicious-consumption review workflow
// ---------------------------------------------------------------------------
export type FlagAction = 'review' | 'dismiss' | 'escalate'

export function startReview(row: Pick<FuelRow, 'id' | 'ref'>, note?: string) {
  const { fuelTransactions, update } = useDb.getState()
  const tx = fuelTransactions.find((t) => t.id === row.id)
  const flag = tx && flagOf(tx)
  if (!tx || !flag) return
  const review: FlagReview = { status: 'reviewing', by: currentUserName(), at: new Date().toISOString(), note: note || undefined }
  const next: FuelFlag = { ...flag, review }
  update('fuelTransactions', tx.id, { flag: next }, { summary: `Started review of fuel flag on ${tx.ref}: ${flag.reason}${note ? ` — ${note}` : ''}` })
  toast.success(`${tx.ref} marked as under review`)
}

export function dismissFlag(row: Pick<FuelRow, 'id' | 'ref'>, note: string) {
  const { fuelTransactions, update } = useDb.getState()
  const tx = fuelTransactions.find((t) => t.id === row.id)
  const flag = tx && flagOf(tx)
  if (!tx || !flag) return
  update('fuelTransactions', tx.id, { flag: null }, { action: 'approve', summary: `Dismissed fuel flag on ${tx.ref} (“${flag.reason}”) as a false positive — ${note}` })
  toast.success(`Flag on ${tx.ref} dismissed`, { description: 'Recorded in the audit log.' })
}

export function dismissMany(rows: Pick<FuelRow, 'id' | 'ref'>[], note: string): number {
  const { fuelTransactions, updateMany } = useDb.getState()
  const set = new Set(rows.map((r) => r.id))
  const ids = fuelTransactions.filter((t) => set.has(t.id) && t.flag).map((t) => t.id)
  if (ids.length) updateMany('fuelTransactions', ids, { flag: null }, { action: 'approve', summary: `Dismissed ${ids.length} fuel flag${ids.length === 1 ? '' : 's'} as false positives — ${note}` })
  return ids.length
}

const RULE_TO_INCIDENT: Record<string, Incident['type']> = { overfill: 'theft', odd_hours: 'theft', over_expected: 'theft', duplicate: 'other', odometer: 'other', other: 'other' }

/** Escalates a flagged fill to Safety as an incident and records the escalation on the flag. Returns the incident. */
export function escalateFlag(row: FuelRow, note: string, severity: Incident['severity']): Incident | null {
  const db = useDb.getState()
  const tx = db.fuelTransactions.find((t) => t.id === row.id)
  const flag = tx && flagOf(tx)
  if (!tx || !flag) return null
  const station = db.fuelStations.find((s) => s.id === tx.stationId)
  const year = new Date().getFullYear()
  let max = 0
  for (const i of db.incidents) {
    const m = new RegExp(`^INC-${year}-(\\d+)$`).exec(i.ref)
    if (m) max = Math.max(max, Number(m[1]))
  }
  const rule = row.rule ?? 'other'
  const incident = db.insert(
    'incidents',
    {
      ref: `INC-${year}-${String(max + 1).padStart(3, '0')}`,
      type: RULE_TO_INCIDENT[rule] ?? 'other',
      severity,
      status: 'reported',
      vehicleId: tx.vehicleId,
      driverId: tx.driverId,
      tripId: tx.tripId,
      branchId: tx.branchId,
      date: tx.date,
      location: station ? `${station.name}, ${station.city}` : 'Fuel station',
      lat: station?.lat ?? 0,
      lng: station?.lng ?? 0,
      description: `Suspicious fuel transaction ${tx.ref} escalated from Fuel Management — ${FUEL_RULES[rule].label}: ${flag.reason}. ${tx.litres} L / $${tx.totalUsd.toFixed(2)}, receipt ${tx.receiptNo}. ${note}`,
      injuries: 0,
      thirdPartyInvolved: false,
      estCostUsd: Math.round(tx.totalUsd),
      insuranceClaim: false,
      reportedBy: currentUserName(),
    },
    { summary: `Raised incident from fuel transaction ${tx.ref}` },
  )
  const review: FlagReview = { status: 'escalated', by: currentUserName(), at: new Date().toISOString(), note, incidentId: incident.id }
  const next: FuelFlag = { ...flag, review }
  db.update('fuelTransactions', tx.id, { flag: next }, { summary: `Escalated fuel flag on ${tx.ref} to incident ${incident.ref}` })
  toast.success(`${tx.ref} escalated to Safety`, {
    description: `Incident ${incident.ref} created for investigation.`,
    action: { label: 'View incident', onClick: () => navigateTo(`/safety/incidents?open=${incident.id}`) },
  })
  return incident
}
