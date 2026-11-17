import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Admin-only preferences that have no home in the shared settings store. Key starts with `fleetcore.settings` so "Reset demo data" keeps it. */
export interface QuietHours {
  enabled: boolean
  /** HH:mm, local time */
  from: string
  to: string
  /** Critical alerts are delivered even during quiet hours */
  criticalBypass: boolean
}

interface AdminPrefsState {
  quietHours: QuietHours
  setQuietHours: (patch: Partial<QuietHours>) => void
}

export const useAdminPrefs = create<AdminPrefsState>()(
  persist(
    (set) => ({
      quietHours: { enabled: false, from: '22:00', to: '05:30', criticalBypass: true },
      setQuietHours: (patch) => set((s) => ({ quietHours: { ...s.quietHours, ...patch } })),
    }),
    { name: 'fleetcore.settings.admin' },
  ),
)
