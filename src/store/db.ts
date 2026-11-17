import { create } from 'zustand'
import type { AuditEntry } from '@/types'
import { DB_STORAGE_KEY, getSeed, type PersistedDb } from '@/data/bootstrap'
import type { CollectionName, DbData } from '@/data/seed'
import { useSession } from './session'

export type { CollectionName, DbData }
export type ItemOf<K extends CollectionName> = DbData[K][number]
export type NewItem<K extends CollectionName> = Omit<ItemOf<K>, 'id'> & { id?: string }

type Item = { id: string }

const ID_PREFIX: Record<CollectionName, string> = {
  branches: 'br', departments: 'dep', roles: 'role', users: 'usr', geofences: 'geo', vehicles: 'veh', drivers: 'drv', documents: 'doc',
  customers: 'cus', trips: 'trp', shipments: 'shp', fuelStations: 'fs', fuelCards: 'fc', fuelTransactions: 'ftx', providers: 'prv',
  workOrders: 'wo', schedules: 'sch', inspections: 'ins', incidents: 'inc', safetyEvents: 'sev', expenses: 'exp', invoices: 'inv',
  budgets: 'bud', auditLog: 'aud', dailyStats: 'day',
}

const SINGULAR: Record<CollectionName, string> = {
  branches: 'branch', departments: 'department', roles: 'role', users: 'user', geofences: 'geofence', vehicles: 'vehicle', drivers: 'driver',
  documents: 'document', customers: 'customer', trips: 'trip', shipments: 'shipment', fuelStations: 'fuel station', fuelCards: 'fuel card',
  fuelTransactions: 'fuel transaction', providers: 'service provider', workOrders: 'work order', schedules: 'service schedule', inspections: 'inspection',
  incidents: 'incident', safetyEvents: 'safety event', expenses: 'expense', invoices: 'invoice', budgets: 'budget', auditLog: 'audit entry', dailyStats: 'daily stat',
}

/** Human label for an entity, used in audit messages, toasts and global search. */
export function entityLabel(_collection: CollectionName, item: unknown): string {
  const x = item as Record<string, unknown>
  return String(x.reg ?? x.ref ?? x.woNo ?? x.number ?? x.name ?? x.trackingRef ?? x.title ?? x.id)
}

export interface MutateOptions {
  /** Skip the audit log entry (used by the GPS simulator). */
  silent?: boolean
  /** Custom audit summary. */
  summary?: string
  action?: AuditEntry['action']
}

interface DbActions {
  /** Insert a new record. `id` is generated when omitted. Returns the stored record. */
  insert<K extends CollectionName>(collection: K, item: NewItem<K>, opts?: MutateOptions): ItemOf<K>
  /** Shallow-merge `patch` into an existing record. */
  update<K extends CollectionName>(collection: K, id: string, patch: Partial<ItemOf<K>>, opts?: MutateOptions): void
  updateMany<K extends CollectionName>(collection: K, ids: string[], patch: Partial<ItemOf<K>>, opts?: MutateOptions): void
  remove<K extends CollectionName>(collection: K, id: string, opts?: MutateOptions): void
  removeMany<K extends CollectionName>(collection: K, ids: string[], opts?: MutateOptions): void
  /** Next free id for a collection, e.g. "veh-051". */
  nextId(collection: CollectionName): string
  seededAt: number
}

export type DbState = DbData & DbActions

// ---------------------------------------------------------------------------
// Overlay persistence
// ---------------------------------------------------------------------------
const overlay: PersistedDb = { seededAt: 0, upserts: {}, deletes: {} }
let saveTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(overlay))
    } catch (e) {
      console.warn('[db] could not persist overlay', e)
    }
  }, 350)
}

function recordUpsert(c: string, item: Item) {
  ;(overlay.upserts[c] ||= {})[item.id] = item
  const del = overlay.deletes[c]
  if (del) overlay.deletes[c] = del.filter((x) => x !== item.id)
}
function recordDelete(c: string, id: string) {
  if (overlay.upserts[c]) delete overlay.upserts[c]![id]
  ;(overlay.deletes[c] ||= []).push(id)
}

function applyOverlay(data: DbData, persisted: PersistedDb | null): DbData {
  if (!persisted) return data
  const out = { ...data } as Record<string, Item[]>
  for (const [c, upserts] of Object.entries(persisted.upserts)) {
    const list = out[c]
    if (!list) continue
    const pending = new Map(Object.entries(upserts) as [string, Item][])
    const next = list.map((x) => {
      const u = pending.get(x.id)
      if (u) {
        pending.delete(x.id)
        return u
      }
      return x
    })
    out[c] = [...next, ...pending.values()]
  }
  for (const [c, ids] of Object.entries(persisted.deletes)) {
    const set = new Set(ids)
    if (out[c]) out[c] = out[c]!.filter((x) => !set.has(x.id))
  }
  return out as unknown as DbData
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const seed = getSeed()
overlay.seededAt = seed.seededAt
if (seed.persisted) {
  Object.assign(overlay.upserts, seed.persisted.upserts)
  Object.assign(overlay.deletes, seed.persisted.deletes)
} else {
  scheduleSave() // remember seededAt so the next load regenerates the identical dataset
}

export const useDb = create<DbState>()((set, get) => ({
  ...applyOverlay(seed.data, seed.persisted),
  seededAt: seed.seededAt,

  nextId(collection) {
    const prefix = ID_PREFIX[collection]
    let max = 0
    for (const x of get()[collection] as unknown as Item[]) {
      const m = /-(\d+)$/.exec(x.id)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `${prefix}-${String(max + 1).padStart(Math.max(3, String(max + 1).length), '0')}`
  },

  insert(collection, item, opts) {
    const id = item.id ?? get().nextId(collection)
    const record = { ...item, id } as unknown as ItemOf<typeof collection>
    set({ [collection]: [...(get()[collection] as unknown as Item[]), record as unknown as Item] } as Partial<DbData>)
    recordUpsert(collection, record as unknown as Item)
    audit(collection, record, 'create', opts)
    scheduleSave()
    return record
  },

  update(collection, id, patch, opts) {
    const list = get()[collection] as unknown as Item[]
    const idx = list.findIndex((x) => x.id === id)
    if (idx < 0) return
    const next = { ...list[idx]!, ...patch, id } as Item
    const copy = list.slice()
    copy[idx] = next
    set({ [collection]: copy } as Partial<DbData>)
    recordUpsert(collection, next)
    audit(collection, next, opts?.action ?? 'update', opts)
    scheduleSave()
  },

  updateMany(collection, ids, patch, opts) {
    const idSet = new Set(ids)
    const list = get()[collection] as unknown as Item[]
    const changed: Item[] = []
    const copy = list.map((x) => {
      if (!idSet.has(x.id)) return x
      const n = { ...x, ...patch, id: x.id } as Item
      changed.push(n)
      return n
    })
    set({ [collection]: copy } as Partial<DbData>)
    for (const c of changed) recordUpsert(collection, c)
    if (!opts?.silent && changed.length)
      audit(collection, changed[0]!, opts?.action ?? 'update', { ...opts, summary: opts?.summary ?? `Bulk updated ${changed.length} ${SINGULAR[collection]} records` })
    scheduleSave()
  },

  remove(collection, id, opts) {
    const list = get()[collection] as unknown as Item[]
    const target = list.find((x) => x.id === id)
    if (!target) return
    set({ [collection]: list.filter((x) => x.id !== id) } as Partial<DbData>)
    recordDelete(collection, id)
    audit(collection, target, 'delete', opts)
    scheduleSave()
  },

  removeMany(collection, ids, opts) {
    const idSet = new Set(ids)
    const list = get()[collection] as unknown as Item[]
    set({ [collection]: list.filter((x) => !idSet.has(x.id)) } as Partial<DbData>)
    for (const id of ids) recordDelete(collection, id)
    if (!opts?.silent && ids.length) audit(collection, list.find((x) => idSet.has(x.id)) ?? { id: ids[0]! }, 'delete', { ...opts, summary: opts?.summary ?? `Deleted ${ids.length} ${SINGULAR[collection]} records` })
    scheduleSave()
  },
}))

function audit(collection: CollectionName, item: unknown, action: AuditEntry['action'], opts?: MutateOptions) {
  if (opts?.silent || collection === 'auditLog') return
  const userId = useSession.getState().userId
  const user = useDb.getState().users.find((u) => u.id === userId)
  const label = entityLabel(collection, item)
  const verb = { create: 'Created', update: 'Updated', delete: 'Deleted', status: 'Changed status of', assign: 'Assigned', approve: 'Approved', export: 'Exported', login: 'Signed in', system: 'System' }[action]
  const entry: AuditEntry = {
    id: `aud-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    userId: user?.id ?? 'system',
    userName: user?.name ?? 'System',
    action,
    entityType: SINGULAR[collection],
    entityId: (item as Item).id,
    summary: opts?.summary ?? `${verb} ${SINGULAR[collection]} ${label}`,
  }
  useDb.setState((s) => ({ auditLog: [entry, ...s.auditLog] }))
  recordUpsert('auditLog', entry)
}

/** Imperative accessor for non-React code (services, simulator). */
export const db = () => useDb.getState()
