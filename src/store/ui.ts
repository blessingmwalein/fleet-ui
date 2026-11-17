import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'system'
export type RangePreset = '24h' | '7d' | '30d' | '90d' | 'mtd' | 'ytd' | 'custom'

interface UiState {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void

  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  mobileNavOpen: boolean
  setMobileNavOpen: (v: boolean) => void

  /** Global date range (applies to dashboard, reports and analytics views). */
  rangePreset: RangePreset
  customFrom: string // yyyy-MM-dd
  customTo: string
  setRange: (preset: RangePreset, from?: string, to?: string) => void

  /** Global branch / depot scope. "all" = whole company. */
  branchId: string
  setBranchId: (id: string) => void

  commandOpen: boolean
  setCommandOpen: (v: boolean) => void
  notificationsOpen: boolean
  setNotificationsOpen: (v: boolean) => void

  /** Global trip detail drawer (opened from anywhere via <EntityLink type="trip">). */
  tripDrawerId: string | null
  openTrip: (id: string | null) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

      rangePreset: '30d',
      customFrom: '',
      customTo: '',
      setRange: (rangePreset, from, to) => set((s) => ({ rangePreset, customFrom: from ?? s.customFrom, customTo: to ?? s.customTo })),

      branchId: 'all',
      setBranchId: (branchId) => set({ branchId }),

      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      notificationsOpen: false,
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),

      tripDrawerId: null,
      openTrip: (tripDrawerId) => set({ tripDrawerId }),
    }),
    {
      name: 'fleetcore.ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed, rangePreset: s.rangePreset, customFrom: s.customFrom, customTo: s.customTo, branchId: s.branchId }),
    },
  ),
)
