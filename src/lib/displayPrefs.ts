import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Display preferences (date/time format and measurement units) edited in Administration → Settings → General.
 * Plain (non-React) formatters in `lib/format.ts` read these through `displayPrefs()`, so every screen that formats
 * dates, distances or fuel volumes follows the setting the next time it renders / is opened.
 *
 * The storage key starts with `fleetcore.settings` on purpose: "Reset demo data" keeps settings.
 */
export type DateFormatId = 'dd MMM yyyy' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'
export type TimeFormatId = '24h' | '12h'
export type DistanceUnit = 'km' | 'mi'
export type VolumeUnit = 'L' | 'gal'

export interface DisplayPrefs {
  dateFormat: DateFormatId
  timeFormat: TimeFormatId
  distanceUnit: DistanceUnit
  volumeUnit: VolumeUnit
}

export const DEFAULT_DISPLAY: DisplayPrefs = { dateFormat: 'dd MMM yyyy', timeFormat: '24h', distanceUnit: 'km', volumeUnit: 'L' }

interface DisplayPrefsState extends DisplayPrefs {
  setPrefs: (patch: Partial<DisplayPrefs>) => void
}

export const useDisplayPrefs = create<DisplayPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_DISPLAY,
      setPrefs: (patch) => set(patch),
    }),
    { name: 'fleetcore.settings.display' },
  ),
)

/** Non-reactive accessor used by the shared formatters. */
export const displayPrefs = (): DisplayPrefs => useDisplayPrefs.getState()

export const KM_TO_MI = 0.621371
export const L_TO_GAL = 0.264172
