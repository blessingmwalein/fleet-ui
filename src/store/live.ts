import { create } from 'zustand'
import type { Telemetry } from '@/types'

/** Live (non-persisted) telemetry produced by the GPS simulator — or, later, by a real telematics WebSocket. */
interface LiveStore {
  telemetry: Record<string, Telemetry>
  running: boolean
  tick: number
  lastTickAt: number
  setTelemetry: (t: Record<string, Telemetry>) => void
  setRunning: (v: boolean) => void
}

export const useLive = create<LiveStore>()((set) => ({
  telemetry: {},
  running: false,
  tick: 0,
  lastTickAt: 0,
  setTelemetry: (telemetry) => set((s) => ({ telemetry, tick: s.tick + 1, lastTickAt: Date.now() })),
  setRunning: (running) => set({ running }),
}))
