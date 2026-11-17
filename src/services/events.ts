import type { EntityRef, NotificationType, Severity } from '@/types'

/**
 * Operational event contract.
 *
 * Everything that wants to raise a notification publishes a `LiveEvent` on the bus. Today the events come from
 * the in-browser simulator (see `simulation.ts` and `eventSimulator.ts`). To go live, implement `EventSource`
 * with a WebSocket / SSE client that publishes the same payload shape and register it in `realtime.ts`.
 */
export interface LiveEvent {
  type: NotificationType
  severity: Severity
  title: string
  message: string
  entity?: EntityRef
  /** epoch ms; defaults to now */
  ts?: number
}

export type EventHandler = (event: LiveEvent) => void

class EventBus {
  private handlers = new Set<EventHandler>()
  subscribe(handler: EventHandler) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }
  publish(event: LiveEvent) {
    for (const h of this.handlers) {
      try {
        h(event)
      } catch (e) {
        console.error('[events] handler failed', e)
      }
    }
  }
}

export const eventBus = new EventBus()

/** A producer of live events. Implement this for a real transport (WebSocket, SSE, MQTT bridge, ...). */
export interface EventSource {
  readonly name: string
  start(): void
  stop(): void
}
