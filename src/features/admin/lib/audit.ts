import type { AuditEntry, EntityType } from '@/types'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'

/**
 * Writes a custom audit-log entry for changes that are not a database mutation (settings, exports, password
 * resets...). Database CRUD is audited automatically by `useDb`.
 */
export function logAudit(action: AuditEntry['action'], entityType: string, entityId: string, summary: string) {
  const db = useDb.getState()
  const user = db.users.find((u) => u.id === useSession.getState().userId)
  const entry: AuditEntry = {
    id: `aud-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    userId: user?.id ?? 'system',
    userName: user?.name ?? 'System',
    action,
    entityType,
    entityId,
    summary,
  }
  // `insert` persists the entry in the overlay; then move it to the front so "latest first" consumers see it.
  db.insert('auditLog', entry, { silent: true })
  useDb.setState((s) => ({ auditLog: [entry, ...s.auditLog.filter((x) => x.id !== entry.id)] }))
}

/** Maps the free-text `entityType` stored on audit entries to a linkable EntityType. */
const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  vehicle: 'vehicle',
  driver: 'driver',
  trip: 'trip',
  shipment: 'shipment',
  customer: 'customer',
  workorder: 'workorder',
  'work order': 'workorder',
  incident: 'incident',
  expense: 'expense',
  invoice: 'invoice',
  'fuel transaction': 'fuel',
  branch: 'branch',
  user: 'user',
  document: 'document',
}

export function linkableEntityType(entityType: string): EntityType | null {
  return ENTITY_TYPE_MAP[entityType.toLowerCase()] ?? null
}

export const AUDIT_ACTION_LABEL: Record<AuditEntry['action'], string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  status: 'Status',
  login: 'Sign-in',
  export: 'Export',
  assign: 'Assign',
  approve: 'Approve',
  system: 'System',
}
