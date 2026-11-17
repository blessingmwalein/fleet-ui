import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'

export interface ExportEntry {
  id: string
  slug: string
  title: string
  kind: 'CSV' | 'Print'
  file: string
  rows: number
  at: string
  period: string
  /** query string that restores the report's filters */
  search: string
}

export interface LastRun {
  at: string
  period: string
  search: string
}

interface HistoryState {
  exports: ExportEntry[]
  lastRun: Record<string, LastRun>
  markRun: (slug: string, run: LastRun) => void
  logExport: (e: Omit<ExportEntry, 'id' | 'at'>) => void
  clearExports: () => void
}

/** Recent exports + last-run times, kept in localStorage so the report centre can show them. */
export const useReportHistory = create<HistoryState>()(
  persist(
    (set) => ({
      exports: [],
      lastRun: {},
      markRun: (slug, run) => set((s) => ({ lastRun: { ...s.lastRun, [slug]: run } })),
      logExport: (e) => {
        const entry: ExportEntry = { ...e, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString() }
        set((s) => ({ exports: [entry, ...s.exports].slice(0, 15) }))
        // Audit trail: exports are recorded in the audit log.
        try {
          const userId = useSession.getState().userId
          const user = useDb.getState().users.find((u) => u.id === userId)
          useDb.getState().insert(
            'auditLog',
            { id: `aud-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: entry.at, userId: user?.id ?? 'system', userName: user?.name ?? 'System', action: 'export', entityType: 'report', entityId: e.slug, summary: `Exported ${e.title} report (${e.kind}) – ${e.rows} rows` },
            { silent: true },
          )
        } catch {
          /* audit is best-effort */
        }
      },
      clearExports: () => set({ exports: [] }),
    }),
    { name: 'fleetcore.reports', partialize: (s) => ({ exports: s.exports, lastRun: s.lastRun }) },
  ),
)
