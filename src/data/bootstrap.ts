import { buildSeed, type SeedResult } from './seed'

/**
 * The demo dataset is generated deterministically from a single timestamp (`seededAt`).
 * Only the user's changes (an "overlay") are persisted in localStorage — on the next load the seed is
 * regenerated from `seededAt` and the overlay is re-applied. This keeps storage tiny while allowing a rich dataset.
 */
export const DB_STORAGE_KEY = 'fleetcore.db.v1'
export const SIM_STORAGE_KEY = 'fleetcore.sim.v1'
export const NOTIF_STORAGE_KEY = 'fleetcore.notifications.v1'

export interface PersistedDb {
  seededAt: number
  upserts: Record<string, Record<string, unknown>>
  deletes: Record<string, string[]>
}

export function readPersistedDb(): PersistedDb | null {
  try {
    const raw = localStorage.getItem(DB_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedDb
    if (typeof parsed.seededAt !== 'number') return null
    return { seededAt: parsed.seededAt, upserts: parsed.upserts ?? {}, deletes: parsed.deletes ?? {} }
  } catch {
    return null
  }
}

let cached: (SeedResult & { persisted: PersistedDb | null }) | null = null

export function getSeed() {
  if (!cached) {
    const persisted = readPersistedDb()
    const seed = buildSeed(persisted?.seededAt ?? Date.now())
    cached = { ...seed, persisted }
  }
  return cached
}

/** Wipes every FleetCore key and reloads — used by "Reset demo data". */
export function resetDemoData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('fleetcore.') && !k.startsWith('fleetcore.ui') && !k.startsWith('fleetcore.settings')) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
  location.reload()
}
