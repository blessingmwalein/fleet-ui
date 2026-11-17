import { wireNotificationBridge } from '@/store/notifications'
import { eventSource } from './eventSimulator'
import { startSimulation, stopSimulation } from './simulation'

/**
 * Real-time layer bootstrap.
 *
 * Demo: an in-browser GPS simulator produces telemetry + events.
 * Production: replace `startSimulation()` / `eventSource` with a WebSocket client that
 *   1. writes `Telemetry` frames into `useLive.getState().setTelemetry(...)` and `fixBuffer`, and
 *   2. publishes `LiveEvent`s on `eventBus` (the notification centre already subscribes to the bus).
 * Nothing else in the UI needs to change.
 */
export function startRealtime() {
  wireNotificationBridge()
  startSimulation()
  eventSource.start()
  return () => {
    eventSource.stop()
    stopSimulation()
  }
}
